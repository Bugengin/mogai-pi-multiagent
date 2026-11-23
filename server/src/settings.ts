import fs from "node:fs";
import path from "node:path";

export interface EngineSettings {
  engine: "mock" | "pi";
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  maxTaskSeconds: number;
  maxCostUsd: number;
  maxConcurrency: number;
  stuckSeconds: number;
  relayPreflight: boolean;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface PublicSettings {
  engine: "mock" | "pi";
  provider: string;
  modelId: string;
  baseUrl?: string;
  hasApiKey: boolean;
  maxTaskSeconds: number;
  maxCostUsd: number;
  maxConcurrency: number;
  stuckSeconds: number;
  relayPreflight: boolean;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  requestTimeoutMs: number;
}

const DEFAULTS: EngineSettings = {
  engine: "mock",
  provider: "openai",
  modelId: "gpt-4.1",
  apiKey: "",
  maxTaskSeconds: 300,
  maxCostUsd: 1.5,
  maxConcurrency: 4,
  stuckSeconds: 90,
  relayPreflight: true,
  connectTimeoutMs: 5000,
  readTimeoutMs: 8000,
  requestTimeoutMs: 90000
};

export const KNOWN_PROVIDERS = [
  "openai", "anthropic", "google", "openrouter", "deepseek", "xai", "groq", "mistral"
];

function envStr(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * 设置存储：**配置文件只保存非密钥项**；API Key 单独存 `credentials.json`（0600），
 * 且优先使用环境变量 `PI_API_KEY`，避免密钥进入 Git / 日志 / 截图。
 * 支持环境变量覆盖：PI_ENGINE / PI_PROVIDER / PI_MODEL_ID / PI_BASE_URL。
 */
export class SettingsStore {
  private file: string;
  private credFile: string;

  constructor(file: string) {
    this.file = file;
    this.credFile = path.join(path.dirname(file), "credentials.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.migrateLegacy();
  }

  /** 老版本把 apiKey 写在 settings.json 里：首次启动搬到 credentials.json 并从配置文件删除。 */
  private migrateLegacy(): void {
    try {
      if (fs.existsSync(this.credFile)) return;
      const raw = fs.readFileSync(this.file, "utf8");
      const j = JSON.parse(raw) as Record<string, unknown>;
      const key = typeof j.apiKey === "string" ? j.apiKey : "";
      if (!key) return;
      this.writeCred(key);
      delete j.apiKey;
      fs.writeFileSync(this.file, JSON.stringify(j, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }

  private readCred(): string {
    try {
      const j = JSON.parse(fs.readFileSync(this.credFile, "utf8")) as { apiKey?: string };
      return typeof j.apiKey === "string" ? j.apiKey : "";
    } catch {
      return "";
    }
  }

  private writeCred(key: string): void {
    fs.writeFileSync(this.credFile, JSON.stringify({ apiKey: key }, null, 2), { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(this.credFile, 0o600);
    } catch {
      /* Windows 忽略 */
    }
  }

  /** 实际生效的 API Key：环境变量优先，其次本地凭据文件。 */
  getApiKey(): string {
    return envStr("PI_API_KEY") || this.readCred();
  }

  load(): EngineSettings {
    let raw: Partial<EngineSettings> = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<EngineSettings>;
    } catch {
      raw = {};
    }
    const merged: EngineSettings = { ...DEFAULTS, ...raw, apiKey: this.getApiKey() };
    const ep = envStr("PI_PROVIDER");
    if (ep) merged.provider = ep;
    const em = envStr("PI_MODEL_ID") || envStr("PI_MODEL");
    if (em) merged.modelId = em;
    const eb = envStr("PI_BASE_URL");
    if (eb !== undefined) merged.baseUrl = eb;
    const ee = envStr("PI_ENGINE");
    if (ee === "mock" || ee === "pi") merged.engine = ee;
    return merged;
  }

  save(patch: Partial<EngineSettings>): EngineSettings {
    const { apiKey, ...rest } = patch as Partial<EngineSettings> & { apiKey?: string };
    let base: Partial<EngineSettings> = {};
    try {
      base = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<EngineSettings>;
    } catch {
      base = {};
    }
    const next: EngineSettings = { ...DEFAULTS, ...base, ...rest };
    const toWrite: Record<string, unknown> = { ...next };
    delete toWrite.apiKey; // 配置文件绝不落真实密钥
    fs.writeFileSync(this.file, JSON.stringify(toWrite, null, 2), "utf8");
    if (typeof apiKey === "string") {
      if (apiKey.trim()) this.writeCred(apiKey.trim());
      else {
        try {
          fs.unlinkSync(this.credFile);
        } catch {
          /* ignore */
        }
      }
    }
    return { ...next, apiKey: this.getApiKey() };
  }

  publicSettings(): PublicSettings {
    const s = this.load();
    return {
      engine: s.engine,
      provider: s.provider,
      modelId: s.modelId,
      baseUrl: s.baseUrl,
      hasApiKey: !!this.getApiKey(),
      maxTaskSeconds: s.maxTaskSeconds,
      maxCostUsd: s.maxCostUsd,
      maxConcurrency: s.maxConcurrency,
      stuckSeconds: s.stuckSeconds,
      relayPreflight: s.relayPreflight,
      connectTimeoutMs: s.connectTimeoutMs,
      readTimeoutMs: s.readTimeoutMs,
      requestTimeoutMs: s.requestTimeoutMs
    };
  }
}
