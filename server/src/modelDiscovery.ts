import https from "node:https";
import http from "node:http";

export interface DiscoveredModel { id: string; name?: string; }
export interface DiscoverResult { ok: boolean; models?: DiscoveredModel[]; message?: string; }

type Kind = "openai" | "anthropic" | "google";
interface ProviderMeta { baseUrl: string; kind: Kind; publicNoKey?: boolean; }

const MAP: Record<string, ProviderMeta> = {
  openai: { baseUrl: "https://api.openai.com/v1", kind: "openai" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", kind: "anthropic" },
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", kind: "google" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", kind: "openai", publicNoKey: true },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", kind: "openai" },
  xai: { baseUrl: "https://api.x.ai/v1", kind: "openai" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", kind: "openai" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", kind: "openai" }
};

interface HttpResp { status: number; contentType: string; url: string; body: string; }

function httpGet(url: string, headers: Record<string, string>, timeoutMs = 15000, redirects = 0): Promise<HttpResp> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(url); } catch { resolve({ status: 0, contentType: "", url, body: "bad url" }); return; }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      { method: "GET", hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers },
      (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && redirects < 4) {
          res.resume();
          resolve(httpGet(new URL(loc, u).toString(), headers, timeoutMs, redirects + 1));
          return;
        }
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status, contentType: String(res.headers["content-type"] || ""), url, body: d }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, contentType: "", url, body: String(e) }));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function candidateUrls(meta: ProviderMeta, base: string): string[] {
  if (meta.kind === "anthropic") return [base + "/models?limit=1000"];
  if (meta.kind === "google") return [base + "/models"];
  const b = base.replace(/\/+$/, "");
  if (/\/v1$/i.test(b)) return [b + "/models"];
  return [b + "/v1/models", b + "/models"];
}

export async function discoverModels(provider: string, apiKey: string, baseUrl?: string): Promise<DiscoverResult> {
  const p = provider.toLowerCase();
  const meta = MAP[p];
  if (!meta) return { ok: false, message: "暂不支持的供应商：" + provider };
  const key = (apiKey || "").trim();
  if (!meta.publicNoKey && !key) return { ok: false, message: "请先填写 API Key" };

  const base = baseUrl && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/, "") : meta.baseUrl;
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (meta.kind === "openai") { if (key) headers["Authorization"] = "Bearer " + key; }
  else if (meta.kind === "anthropic") { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }

  const urls = candidateUrls(meta, base);
  let lastErr = "未获取到模型";
  for (let i = 0; i < urls.length; i++) {
    let url = urls[i];
    if (meta.kind === "google") url = url + "?key=" + encodeURIComponent(key) + "&pageSize=1000";

    const res = await httpGet(url, headers);
    if (res.status === 0) { lastErr = "请求失败：" + res.body.replace(/^ERR /, "") + "（" + res.url + "，可能无法直达，请用 Base URL 中转）"; continue; }
    const bodyTrim = res.body.trim();
    if (/html/i.test(res.contentType) || bodyTrim.startsWith("<")) {
      lastErr = "端点返回 HTML（HTTP " + res.status + "，" + res.url + "）：该地址不是 API 端点。若用中转，请填其根地址（会自动尝试 /v1/models）。";
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      let hint = bodyTrim.slice(0, 200);
      try { const j: any = JSON.parse(bodyTrim); if (j.error) hint = j.error.message || JSON.stringify(j.error); } catch { /* keep */ }
      lastErr = "HTTP " + res.status + "：" + hint + "（" + res.url + "）";
      continue;
    }
    try {
      const j: any = JSON.parse(bodyTrim);
      let models: DiscoveredModel[] = [];
      if (meta.kind === "google") {
        models = (j.models || []).map((m: any) => ({ id: String(m.name || "").replace(/^models\//, ""), name: m.displayName }));
      } else {
        models = (j.data || []).map((m: any) => ({ id: String(m.id || m.name || ""), name: m.display_name || m.name }));
      }
      models = models.filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id));
      const note = i > 0 ? "（自动使用端点 " + res.url + "）" : undefined;
      return { ok: true, models, message: note };
    } catch (e) {
      lastErr = "解析失败（" + res.url + "）：" + String(e).slice(0, 120) + "；原始：" + bodyTrim.slice(0, 100);
      continue;
    }
  }
  return { ok: false, message: lastErr };
}
