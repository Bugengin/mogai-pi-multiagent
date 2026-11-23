import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * 中转/模型端点的健康探测。
 *
 * 这里刻意用原生 http(s) 自己实现三种超时，和真实模型调用解耦：
 *  - connectTimeoutMs：TCP/TLS 建连超时（DNS + 握手）；
 *  - readTimeoutMs：连接建立后，等待响应数据的空闲超时；
 *  - totalTimeoutMs：单次探测的硬总超时（兜底，防止任何阶段卡死）。
 *
 * 只要探测能明确返回（ok / 各类失败 + stage），调用方就不会无限等待。
 */

export type RelayStage =
  | "ok"
  | "config"
  | "dns"
  | "connect"
  | "read"
  | "total"
  | "http"
  | "html"
  | "parse"
  | "auth";

export interface RelayTimeouts {
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface RelayProbeResult {
  ok: boolean;
  reachable: boolean; // 是否成功建立了 TCP/TLS 连接
  status: number; // HTTP 状态码，0 表示没拿到响应
  url: string;
  stage: RelayStage;
  latencyMs: number;
  message: string;
  body?: string;
  contentType?: string;
}

const DEFAULT_CONNECT = 5000;
const DEFAULT_READ = 8000;
const DEFAULT_TOTAL = 12000;

export function probeUrl(url: string, headers: Record<string, string>, timeouts: RelayTimeouts = {}): Promise<RelayProbeResult> {
  const connectMs = Math.max(300, timeouts.connectTimeoutMs ?? DEFAULT_CONNECT);
  const readMs = Math.max(300, timeouts.readTimeoutMs ?? DEFAULT_READ);
  const totalMs = Math.max(600, timeouts.totalTimeoutMs ?? DEFAULT_TOTAL);

  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve({ ok: false, reachable: false, status: 0, url, stage: "config", latencyMs: 0, message: "非法 URL" });
      return;
    }
    const isHttps = u.protocol === "https:";
    const lib = isHttps ? https : http;
    let connected = false;
    // IP 直连没有 DNS 阶段；域名要等 socket 的 lookup 事件才算解析完成。
    let dnsResolved = isIP(u.hostname) !== 0;
    let stage: RelayStage = "connect";
    let body = "";
    let req: any;
    let socket: any = null;
    let readT: ReturnType<typeof setTimeout> | null = null;

    function clearReadTimer(): void {
      if (readT) {
        clearTimeout(readT);
        readT = null;
      }
    }
    function armReadTimer(): void {
      clearReadTimer();
      readT = setTimeout(() => finish({ stage: "read", message: "读取超时（" + readMs + "ms 无数据）" }), readMs);
    }
    function markConnected(): void {
      if (connected) return;
      connected = true;
      clearTimeout(connectTimer);
      // 关闭 Node 自带的 socket 空闲超时，改由 readTimer 精确控制读取阶段。
      if (socket) {
        try { socket.setTimeout(0); } catch { /* ignore */ }
      }
      if (stage === "connect") stage = "read";
      armReadTimer();
    }
    function finish(patch: Partial<RelayProbeResult>): void {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      clearReadTimer();
      try { if (socket) socket.removeAllListeners(); } catch { /* ignore */ }
      try { if (req) req.removeAllListeners(); } catch { /* ignore */ }
      try { if (req) req.destroy(); } catch { /* ignore */ }
      try { if (socket) socket.destroy(); } catch { /* ignore */ }
      resolve({
        ok: false,
        reachable: connected,
        status: 0,
        url,
        stage,
        latencyMs: Date.now() - started,
        message: "",
        ...patch
      });
    }

    // 建连阶段：DNS 未完成算 dns，已解析但 TCP/TLS 未完成算 connect。
    const connectTimer = setTimeout(
      () =>
        finish({
          stage: dnsResolved ? "connect" : "dns",
          message: dnsResolved ? "连接超时（" + connectMs + "ms）" : "DNS 解析超时（" + connectMs + "ms）"
        }),
      connectMs
    );
    // 总时限兜底：任何阶段超过都算 total，哪怕数据仍在持续返回。
    const totalTimer = setTimeout(() => finish({ stage: "total", message: "总超时（" + totalMs + "ms）" }), totalMs);

    req = lib.request(
      { method: "GET", hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers },
      (res) => {
        markConnected();
        stage = "http";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          body += c;
          armReadTimer(); // 每收到数据都重置读取定时器，分块响应不会被误判超时
        });
        res.on("end", () => {
          const status = res.statusCode || 0;
          const ct = String(res.headers["content-type"] || "");
          finish({ status, contentType: ct, body, reachable: true, stage: "http", message: "HTTP " + status });
        });
        res.on("error", (e: Error) => finish({ stage: "read", message: "读取错误：" + String(e && e.message) }));
      }
    );

    req.on("socket", (s: any) => {
      socket = s;
      s.once("lookup", (err: Error | null) => {
        // lookup 可能带错误（ENOTFOUND/EAI_AGAIN），只有成功解析才算 DNS 完成
        if (!err) dnsResolved = true;
      });
      if (!s.connecting) markConnected();
      if (isHttps) {
        // https 要等 TLS 握手完成（secureConnect）才算建连成功
        s.once("secureConnect", () => markConnected());
      } else {
        s.once("connect", () => markConnected());
      }
      s.on("error", (e: NodeJS.ErrnoException) => {
        if (connected) return;
        const code = e && e.code;
        const st: RelayStage = !dnsResolved && (code === "ENOTFOUND" || code === "EAI_AGAIN") ? "dns" : "connect";
        finish({ stage: st, message: "连接错误：" + String((e && e.message) || e) + (code ? "（" + code + "）" : "") });
      });
    });

    req.on("error", (e: NodeJS.ErrnoException) => {
      const code = e && e.code;
      let st: RelayStage = connected ? "read" : "connect";
      if (!connected && !dnsResolved && (code === "ENOTFOUND" || code === "EAI_AGAIN")) st = "dns";
      finish({ stage: st, message: String((e && e.message) || e) + (code ? "（" + code + "）" : "") });
    });

    req.end();
  });
}

export interface HealthDatabase {
  ok: boolean;
  error?: string;
}

export interface HealthRelay {
  required: boolean;
  ok: boolean;
  stage?: string;
  message?: string;
  latencyMs?: number;
  cached?: boolean;
  checkedAt?: number;
  ageMs?: number;
}

export interface HealthPayloadInput {
  engine: "mock" | "pi";
  database: HealthDatabase;
  relay: HealthRelay;
}

export interface HealthPayload {
  httpStatus: number;
  body: {
    ok: boolean;
    status: "ok" | "degraded" | "error";
    mode: "real" | "mock";
    engine: "mock" | "pi";
    service: { ok: boolean };
    database: HealthDatabase;
    relay: HealthRelay;
    ts: number;
  };
}

/**
 * 汇总整体健康语义：
 *  - 服务自身异常 / 数据库不可用 -> error（HTTP 503）；
 *  - 依赖（中转）必需但不可用 -> degraded（HTTP 200，服务可用）；
 *  - mock 模式不要求中转 -> ok。
 * 这样「进程活着但模型不可用」不再伪装成完全健康。
 */
export function buildHealthPayload(input: HealthPayloadInput): HealthPayload {
  const mode: "real" | "mock" = input.engine === "pi" ? "real" : "mock";
  let status: "ok" | "degraded" | "error" = "ok";
  if (!input.database.ok) status = "error";
  else if (input.relay.required && !input.relay.ok) status = "degraded";
  return {
    httpStatus: status === "error" ? 503 : 200,
    body: {
      ok: status === "ok",
      status,
      mode,
      engine: input.engine,
      service: { ok: true },
      database: input.database,
      relay: input.relay,
      ts: Date.now()
    }
  };
}

export interface RelayHealthConfig {
  baseUrl?: string;
  provider?: string;
  apiKey?: string;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface RelayAttempt {
  url: string;
  stage: RelayStage;
  status: number;
  latencyMs: number;
  message: string;
}

export interface RelayHealth {
  ok: boolean;
  reachable: boolean;
  authOk: boolean;
  stage: RelayStage;
  url: string;
  latencyMs: number;
  checkedAt: number;
  baseUrl: string;
  message: string;
  modelCount?: number;
  attempts: RelayAttempt[];
}

const DEFAULT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  openai_compatible: "https://api.openai.com/v1"
};

function candidateUrls(base: string): string[] {
  const b = base.replace(/\/+$/, "");
  if (/\/v1$/i.test(b)) return [b + "/models"];
  return [b + "/v1/models", b + "/models"];
}

/**
 * 探测中转是否可用。返回明确 stage 与 message，调用方据此快速失败，
 * 不要让它进入 stuck / 仲裁。
 */
export async function checkRelayHealth(cfg: RelayHealthConfig): Promise<RelayHealth> {
  const checkedAt = Date.now();
  const base = (cfg.baseUrl && cfg.baseUrl.trim()) || (cfg.provider && DEFAULT_BASE[cfg.provider.toLowerCase()]) || "";
  if (!base) {
    return {
      ok: false,
      reachable: false,
      authOk: false,
      stage: "config",
      url: "",
      latencyMs: 0,
      checkedAt,
      baseUrl: "",
      message: "未配置 Base URL，且供应商无默认端点",
      attempts: []
    };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = (cfg.apiKey || "").trim();
  if (key) headers["Authorization"] = "Bearer " + key;

  const urls = candidateUrls(base);
  const attempts: RelayAttempt[] = [];
  let best: RelayHealth | null = null;

  for (const url of urls) {
    const r = await probeUrl(url, headers, {
      connectTimeoutMs: cfg.connectTimeoutMs,
      readTimeoutMs: cfg.readTimeoutMs,
      totalTimeoutMs: cfg.totalTimeoutMs
    });
    const bodyTrim = (r.body || "").trim();
    const isHtml = /html/i.test(r.contentType || "") || bodyTrim.startsWith("<");

    // HTTP 层面拿到了响应
    if (r.status > 0) {
      attempts.push({ url, stage: r.stage, status: r.status, latencyMs: r.latencyMs, message: r.message });
      if (isHtml) {
        best = { ok: false, reachable: true, authOk: false, stage: "html", url, latencyMs: r.latencyMs, checkedAt, baseUrl: base, message: "端点返回 HTML（HTTP " + r.status + "），不是 API 端点；若用中转请填根地址", attempts };
        continue;
      }
      if (r.status === 401 || r.status === 403) {
        best = { ok: false, reachable: true, authOk: false, stage: "auth", url, latencyMs: r.latencyMs, checkedAt, baseUrl: base, message: "中转可达，但鉴权失败（HTTP " + r.status + "）：检查 API Key", attempts };
        continue;
      }
      if (r.status >= 200 && r.status < 300) {
        let modelCount: number | undefined;
        let parsed = true;
        try {
          const j: any = JSON.parse(bodyTrim);
          const arr = j && (j.data || j.models);
          modelCount = Array.isArray(arr) ? arr.length : undefined;
        } catch {
          parsed = false;
        }
        if (!parsed) {
          best = { ok: false, reachable: true, authOk: true, stage: "parse", url, latencyMs: r.latencyMs, checkedAt, baseUrl: base, message: "HTTP " + r.status + " 但响应非 JSON", attempts };
          continue;
        }
        return { ok: true, reachable: true, authOk: true, stage: "ok", url, latencyMs: r.latencyMs, checkedAt, baseUrl: base, message: "中转可用（HTTP " + r.status + (modelCount != null ? "，" + modelCount + " 个模型" : "") + "，" + r.latencyMs + "ms）", modelCount, attempts };
      }
      best = { ok: false, reachable: true, authOk: true, stage: "http", url, latencyMs: r.latencyMs, checkedAt, baseUrl: base, message: "中转返回 HTTP " + r.status + "（" + bodyTrim.slice(0, 120) + "）", attempts };
      continue;
    }

    // 根本没拿到 HTTP 响应（超时/DNS/连接失败）
    attempts.push({ url, stage: r.stage, status: 0, latencyMs: r.latencyMs, message: r.message });
    if (!best || best.stage === "html" || best.stage === "http") {
      best = { ok: false, reachable: r.reachable, authOk: false, stage: r.stage, url, latencyMs: r.latencyMs, checkedAt, baseUrl: base, message: "不可达（" + r.stage + "）：" + r.message, attempts };
    }
  }

  return best || { ok: false, reachable: false, authOk: false, stage: "connect", url: urls[0] || "", latencyMs: 0, checkedAt, baseUrl: base, message: "未获得任何响应", attempts };
}
