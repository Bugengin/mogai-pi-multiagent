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
}

const DEFAULTS: EngineSettings = {
  engine: "mock",
  provider: "openai",
  modelId: "gpt-4.1",
  apiKey: "",
  maxTaskSeconds: 300,
  maxCostUsd: 1.5,
  maxConcurrency: 4,
  stuckSeconds: 90
};

export const KNOWN_PROVIDERS = [
  "openai", "anthropic", "google", "openrouter", "deepseek", "xai", "groq", "mistral"
];

export class SettingsStore {
  private file: string;
  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  load(): EngineSettings {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const j = JSON.parse(raw) as Partial<EngineSettings>;
      return { ...DEFAULTS, ...j };
    } catch {
      return { ...DEFAULTS };
    }
  }

  save(patch: Partial<EngineSettings>): EngineSettings {
    const next: EngineSettings = { ...this.load(), ...patch };
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  publicSettings(): PublicSettings {
    const s = this.load();
    return {
      engine: s.engine,
      provider: s.provider,
      modelId: s.modelId,
      baseUrl: s.baseUrl,
      hasApiKey: !!s.apiKey,
      maxTaskSeconds: s.maxTaskSeconds,
      maxCostUsd: s.maxCostUsd,
      maxConcurrency: s.maxConcurrency,
      stuckSeconds: s.stuckSeconds
    };
  }
}