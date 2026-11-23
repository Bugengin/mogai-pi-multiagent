import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Orchestrator } from "./orchestrator";
import { Store } from "./store";
import { DataStore } from "./dataStore";
import { SettingsStore, KNOWN_PROVIDERS } from "./settings";
import { testConnection, judgeAnswer, JUDGE_PROMPT_VERSION } from "./piEngine";
import { discoverModels } from "./modelDiscovery";
import { checkRelayHealth, buildHealthPayload } from "./relayHealth";
import { DatabaseSync } from "node:sqlite";
import { EvalService, toEvalplatReport, toEvalplatDataset } from "./evalService";
import { readAuthority, readAuthorityMaterials, readAuthorityMaterial, readAuthorityCases, readAuthorityReleases, readAuthorityDataset, findEvalplatDb } from "./authority";
import { computeStability, renderStabilityMarkdown } from "./stability";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const dataDir = path.resolve(__dirname, "../.data");
const store = new Store(path.join(dataDir, "pi.db"));
const settingsStore = new SettingsStore(path.join(dataDir, "settings.json"));
// 证据校验根目录：生产接入数据中台时指向 agent_snapshots/<release>/materials/... 的只读快照
const evidenceRoot = process.env.PI_EVIDENCE_ROOT
  ? path.resolve(process.env.PI_EVIDENCE_ROOT)
  : path.resolve(__dirname, "../../demo-workspace");
const WORKSPACES: Record<string, string> = {
  export: evidenceRoot,
  api500: path.resolve(__dirname, "../../demo-api"),
  report: path.resolve(__dirname, "../../demo-report")
};
const resolveWorkspace = (name?: string): string => (name && WORKSPACES[name] ? WORKSPACES[name] : evidenceRoot);
const orch = new Orchestrator(store, resolveWorkspace, () => settingsStore.load());
const evalService = new EvalService(dataDir);
const dataStore = new DataStore(path.join(dataDir, "pi.db"));

function derivedMode(s: { engine: "mock" | "pi" }): "mock" | "real" {
  return s.engine === "pi" ? "real" : "mock";
}

const RELAY_CACHE_TTL_MS = 15000;
let relayHealthCache: { at: number; health: Awaited<ReturnType<typeof checkRelayHealth>> } | null = null;

/** 数据库可用性：能只读打开并执行一次查询才算健康。 */
function checkDatabaseHealth(): { ok: boolean; error?: string } {
  const p = path.join(dataDir, "pi.db");
  try {
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      db.prepare("SELECT 1").get();
    } finally {
      db.close();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  }
}

type RelayForHealth = {
  required: boolean;
  ok: boolean;
  stage: string;
  message: string;
  latencyMs: number;
  cached: boolean;
  checkedAt?: number;
  ageMs?: number;
};

/**
 * 供 /api/health 使用的缓存探测：
 *  - mock 模式不要求中转，直接 ok；
 *  - 真实模式优先用 15s 缓存，避免每次健康检查都阻塞在慢探测上；
 *  - 缓存失效时才真探，且把总超时压到 8s，避免 UI 打开被拖死。
 */
async function relayStatusForHealth(force: boolean): Promise<RelayForHealth> {
  const s = settingsStore.load();
  if (s.engine !== "pi") {
    return { required: false, ok: true, stage: "ok", message: "mock 模式不要求中转", latencyMs: 0, cached: false };
  }
  if (!force && relayHealthCache && Date.now() - relayHealthCache.at < RELAY_CACHE_TTL_MS) {
    const h = relayHealthCache.health;
    return {
      required: true,
      ok: h.ok,
      stage: h.stage,
      message: h.message,
      latencyMs: h.latencyMs,
      cached: true,
      checkedAt: h.checkedAt,
      ageMs: Date.now() - relayHealthCache.at
    };
  }
  const h = await checkRelayHealth({
    baseUrl: s.baseUrl,
    provider: s.provider,
    apiKey: s.apiKey,
    connectTimeoutMs: s.connectTimeoutMs,
    readTimeoutMs: s.readTimeoutMs,
    totalTimeoutMs: Math.min(s.requestTimeoutMs || 8000, 8000)
  });
  relayHealthCache = { at: Date.now(), health: h };
  return {
    required: true,
    ok: h.ok,
    stage: h.stage,
    message: h.message,
    latencyMs: h.latencyMs,
    cached: false,
    checkedAt: h.checkedAt
  };
}

// 整体健康：服务 + 数据库 + 中转依赖。服务/数据库异常 503；仅中转异常为 degraded(200)。
app.get("/api/health", async (_req, res) => {
  const s = settingsStore.publicSettings();
  const database = checkDatabaseHealth();
  let relay: RelayForHealth;
  try {
    relay = await relayStatusForHealth(false);
  } catch (e) {
    relay = { required: s.engine === "pi", ok: false, stage: "config", message: "健康探测异常：" + String(e).slice(0, 120), latencyMs: 0, cached: false };
  }
  const payload = buildHealthPayload({ engine: s.engine, database, relay });
  res.status(payload.httpStatus).json(payload.body);
});

// 中转实时探测：带连接/读取/总超时，明确返回 stage 与 message，供设置页/手动刷新使用。
app.get("/api/health/relay", async (req, res) => {
  const s = settingsStore.load();
  const timeoutOverride = req.query.totalTimeoutMs ? Number(req.query.totalTimeoutMs) : undefined;
  const health = await checkRelayHealth({
    baseUrl: s.baseUrl,
    provider: s.provider,
    apiKey: s.apiKey,
    connectTimeoutMs: s.connectTimeoutMs,
    readTimeoutMs: s.readTimeoutMs,
    totalTimeoutMs: Number.isFinite(timeoutOverride) && timeoutOverride ? timeoutOverride : s.requestTimeoutMs
  });
  relayHealthCache = { at: Date.now(), health };
  res.json({ mode: derivedMode(s), engine: s.engine, required: s.engine === "pi", ...health });
});

/* ---------- settings ---------- */
app.get("/api/settings", (_req, res) => {
  res.json({ ...settingsStore.publicSettings(), providers: KNOWN_PROVIDERS });
});

app.put("/api/settings", (req, res) => {
  const b = req.body || {};
  const patch: Record<string, unknown> = {};
  if (b.engine === "mock" || b.engine === "pi") patch.engine = b.engine;
  if (typeof b.provider === "string") patch.provider = b.provider;
  if (typeof b.modelId === "string") patch.modelId = b.modelId;
  if (typeof b.baseUrl === "string") patch.baseUrl = b.baseUrl;
  if (typeof b.apiKey === "string") patch.apiKey = b.apiKey;
  if (typeof b.maxTaskSeconds === "number") patch.maxTaskSeconds = b.maxTaskSeconds;
  if (typeof b.maxCostUsd === "number") patch.maxCostUsd = b.maxCostUsd;
  if (typeof b.maxConcurrency === "number") patch.maxConcurrency = b.maxConcurrency;
  if (typeof b.stuckSeconds === "number") patch.stuckSeconds = b.stuckSeconds;
  if (typeof b.relayPreflight === "boolean") patch.relayPreflight = b.relayPreflight;
  if (typeof b.connectTimeoutMs === "number") patch.connectTimeoutMs = b.connectTimeoutMs;
  if (typeof b.readTimeoutMs === "number") patch.readTimeoutMs = b.readTimeoutMs;
  if (typeof b.requestTimeoutMs === "number") patch.requestTimeoutMs = b.requestTimeoutMs;
  settingsStore.save(patch as never);
  res.json({ ...settingsStore.publicSettings(), providers: KNOWN_PROVIDERS });
});

app.post("/api/settings/models/discover", async (req, res) => {
  const b = req.body || {};
  const saved = settingsStore.load();
  const provider = b.provider ? String(b.provider) : saved.provider;
  const apiKey = typeof b.apiKey === "string" && b.apiKey ? b.apiKey : saved.apiKey;
  const baseUrl = b.baseUrl !== undefined ? String(b.baseUrl) : saved.baseUrl;
  const r = await discoverModels(provider, apiKey, baseUrl);
  res.json(r);
});

app.post("/api/settings/test", async (req, res) => {
  const b = req.body || {};
  const saved = settingsStore.load();
  const cfg = {
    ...saved,
    provider: typeof b.provider === "string" && b.provider ? b.provider : saved.provider,
    modelId: typeof b.modelId === "string" && b.modelId ? b.modelId : saved.modelId,
    apiKey: typeof b.apiKey === "string" && b.apiKey ? b.apiKey : saved.apiKey
  };
  if (!cfg.apiKey) {
    res.json({ ok: false, message: "还没有填 API Key" });
    return;
  }
  const result = await testConnection(cfg, evidenceRoot);
  res.json(result);
});


/* ---------- authority (只读数据中台，作为权威结果来源) ---------- */
app.get("/api/authority/summary", (_req, res) => {
  res.json(readAuthority());
});
app.get("/api/authority/materials", (_req, res) => {
  res.json(readAuthorityMaterials());
});
app.get("/api/authority/materials/:id", (req, res) => {
  res.json(readAuthorityMaterial(req.params.id));
});
app.get("/api/authority/cases", (_req, res) => {
  res.json(readAuthorityCases());
});
app.get("/api/authority/releases", (_req, res) => {
  res.json(readAuthorityReleases());
});
app.get("/api/authority/datasets/:id", (req, res) => {
  res.json(readAuthorityDataset(req.params.id));
});

/* ---------- data (数据中台 · 资料版本库) ---------- */
app.get("/api/data/documents", (_req, res) => {
  res.json(dataStore.listDocuments());
});

app.post("/api/data/documents", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const content = String(b.content || "");
  if (!name || !content.trim()) { res.status(400).json({ error: "name 和 content 必填" }); return; }
  try {
    const r = dataStore.importDocument({ name, source: b.source ? String(b.source) : undefined, content, note: b.note ? String(b.note) : undefined });
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e).slice(0, 200) }); }
});

app.get("/api/data/documents/:id", (req, res) => {
  const d = dataStore.getDocument(req.params.id);
  if (!d) { res.status(404).json({ error: "not found" }); return; }
  res.json(d);
});

app.get("/api/data/documents/:id/versions/:version", (req, res) => {
  const v = dataStore.getVersionContent(req.params.id, Number(req.params.version));
  if (!v) { res.status(404).json({ error: "not found" }); return; }
  res.json(v);
});

app.post("/api/data/documents/:id/versions", (req, res) => {
  const b = req.body || {};
  const content = String(b.content || "");
  if (!content.trim()) { res.status(400).json({ error: "content 必填" }); return; }
  try {
    const r = dataStore.addVersion(req.params.id, content, b.note ? String(b.note) : undefined);
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e).slice(0, 200) }); }
});

app.delete("/api/data/documents/:id", (req, res) => {
  dataStore.deleteDocument(req.params.id);
  res.json({ ok: true });
});

/* ---------- eval (评测中台联动 · 本地) ---------- */
app.get("/api/eval/cases", (req, res) => {
  const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
  res.json(evalService.listCases(dataset));
});

app.post("/api/eval/cases", (req, res) => {
  const b = req.body || {};
  const goal = String(b.goal || "").trim();
  if (!goal) { res.status(400).json({ error: "goal required" }); return; }
  const expect = Array.isArray(b.expect) ? b.expect.map((x: unknown) => String(x)) : [];
  const created = evalService.addCase({ goal, expect, dataset: b.dataset ? String(b.dataset) : undefined, tags: Array.isArray(b.tags) ? b.tags : undefined });
  res.json(created);
});

app.post("/api/judge/once", async (req, res) => {
  const b = req.body || {};
  const goal = String(b.goal || "");
  const rubric = String(b.rubric || "");
  const actual = String(b.actual || "");
  const workspace = b.workspace ? String(b.workspace) : undefined;
  const st = settingsStore.load();
  if (!(st.engine === "pi" && st.apiKey && st.modelId)) {
    res.status(400).json({ error: "judge 需要真实引擎 + Key" });
    return;
  }
  try {
    const j = await judgeAnswer(st, goal, rubric, actual, resolveWorkspace(workspace));
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: String(e).slice(0, 200) });
  }
});

app.post("/api/eval/run", async (req, res) => {
  const b = req.body || {};
  const dataset = b.dataset ? String(b.dataset) : "demo";
  try {
    const st = settingsStore.load();
    const judge = (st.engine === "pi" && st.apiKey && st.modelId)
      ? async (c: any, actual: string | null) => {
          if (!actual) return null;
          try {
            const j = await judgeAnswer(st, c.goal, c.rubric || "", actual, resolveWorkspace(c.workspace));
            return { score: j.score, passed: j.passed, reason: j.reason };
          } catch { return null; }
        }
      : undefined;
    const repeats = Number.isFinite(Number(b.repeats)) && Number(b.repeats) > 0 ? Number(b.repeats) : 1;
    const aggRaw = String(b.aggregation || "majority");
    const aggregation = aggRaw === "average" || aggRaw === "all" || aggRaw === "majority" ? aggRaw : "majority";
    const run = await evalService.run(dataset, orch, judge, {
      repeats,
      aggregation,
      meta: {
        engine: st.engine,
        provider: st.provider,
        modelId: st.modelId,
        judgeModelId: st.engine === "pi" ? st.modelId : undefined,
        temperature: typeof b.temperature === "number" ? b.temperature : undefined,
        promptVersions: { judge: JUDGE_PROMPT_VERSION },
        notes: b.notes ? String(b.notes) : undefined
      }
    });
    res.json(run);
  } catch (e) {
    res.status(500).json({ error: String(e).slice(0, 300) });
  }
});

app.get("/api/eval/runs", (req, res) => {
  const limit = Number(req.query.limit || 20);
  res.json(evalService.listRuns(Number.isFinite(limit) ? limit : 20));
});

app.get("/api/eval/runs/:id/export", (req, res) => {
  const run = evalService.getRun(req.params.id);
  if (!run) { res.status(404).json({ error: "not found" }); return; }
  const st = settingsStore.load();
  const subject = st.engine === "pi" ? "pi:" + st.provider + "/" + st.modelId : "pi:mock";
  const report = toEvalplatReport(run, subject) as { id: string };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"" + report.id + ".json\"");
  res.send(JSON.stringify(report, null, 2));
});

app.get("/api/eval/datasets/evalplat", (req, res) => {
  const dataset = req.query.dataset ? String(req.query.dataset) : "demo";
  const cases = evalService.listCases(dataset);
  res.json(toEvalplatDataset(cases, dataset));
});

app.post("/api/diag/once", async (req, res) => {
  const goal = String((req.body && req.body.goal) || "").trim();
  if (!goal) { res.status(400).json({ error: "goal required" }); return; }
  const workspace = req.body && req.body.workspace ? String(req.body.workspace) : undefined;
  const started = Date.now();
  try {
    const task = await orch.runToCompletion({ goal, mode: "diagnose", workspace });
    res.json({
      output: {
        rootCause: task.verdict ? task.verdict.rootCause : null,
        confidence: task.verdict ? task.verdict.confidence : "inconclusive",
        materialVersion: task.materialVersion ?? null,
        evidenceRoot: task.evidenceRoot ?? null,
        workspaceFingerprint: task.workspaceFingerprint ?? null,
      },
      usage: { cost_usd: task.spentUsd || 0, tokens: task.spentTokens || 0, latency_ms: Date.now() - started }
    });
  } catch (e) {
    res.status(500).json({ error: String(e).slice(0, 300) });
  }
});

app.get("/api/eval/trends", (req, res) => {
  const limit = Number(req.query.limit || 30);
  const runs = evalService.listRuns(Number.isFinite(limit) ? limit : 30).slice().reverse().map((r) => ({
    id: r.id, dataset: r.dataset, createdAt: r.createdAt,
    passRate: r.summary.passRate, avgScore: r.summary.avgScore,
    totalUsd: r.summary.totalUsd, avgMs: r.summary.avgMs
  }));
  res.json(runs);
});

app.get("/api/eval/runs/:id", (req, res) => {
  const r = evalService.getRun(req.params.id);
  if (!r) { res.status(404).json({ error: "not found" }); return; }
  res.json(r);
});

// 真实引擎多轮稳定性看板（只读评测中台 evalplat.db）
app.get("/api/eval/stability", (req, res) => {
  const dbPath = req.query.db ? String(req.query.db) : findEvalplatDb();
  try {
    res.json(computeStability({
      dbPath,
      subject: req.query.subject ? String(req.query.subject) : undefined,
      version: req.query.version ? String(req.query.version) : undefined
    }));
  } catch (e) {
    res.status(500).json({ available: false, reason: String(e).slice(0, 200) });
  }
});
app.get("/api/eval/stability.md", (req, res) => {
  const dbPath = req.query.db ? String(req.query.db) : findEvalplatDb();
  try {
    const r = computeStability({ dbPath, subject: req.query.subject ? String(req.query.subject) : undefined, version: req.query.version ? String(req.query.version) : undefined });
    res.type("text/plain; charset=utf-8").send(renderStabilityMarkdown(r));
  } catch (e) {
    res.status(500).type("text/plain").send("stability error: " + String(e).slice(0, 200));
  }
});

/* ---------- tasks ---------- */
app.get("/api/tasks", (req, res) => {
  const limit = Number(req.query.limit || 50);
  res.json(orch.listTasks(Number.isFinite(limit) ? limit : 50));
});

app.post("/api/tasks", (req, res) => {
  const body = req.body || {};
  const goal = String(body.goal || "").trim();
  const mode = body.mode === "recon" ? "recon" : "diagnose";
  const scope = body.scope ? String(body.scope) : undefined;
  const workspace = body.workspace ? String(body.workspace) : undefined;
  if (mode === "diagnose" && !goal) {
    res.status(400).json({ error: "goal required for diagnose mode" });
    return;
  }
  const task = orch.createTask({ goal, mode, scope, workspace });
  res.json({ taskId: task.id, task });
});

app.get("/api/tasks/:id", (req, res) => {
  const t = orch.getTask(req.params.id);
  if (!t) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(t);
});

app.delete("/api/tasks/:id", (req, res) => {
  orch.deleteTask(req.params.id);
  res.json({ ok: true });
});

app.post("/api/tasks/:id/pick", (req, res) => {
  const candidateId = String((req.body && req.body.candidateId) || "");
  const error = orch.pickCandidate(req.params.id, candidateId);
  if (error) { res.status(409).json({ error }); return; }
  res.json({ ok: true });
});

app.get("/api/tasks/:id/events", (req, res) => {
  const id = req.params.id;
  const t = orch.getTask(id);
  if (!t) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (ev: unknown): void => {
    res.write("data: " + JSON.stringify(ev) + "\n\n");
  };
  send({ type: "task", task: t });
  const unsub = orch.subscribe(id, send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    unsub();
  });
});

app.post("/api/tasks/:id/stop", (req, res) => {
  orch.stopTask(req.params.id);
  res.json({ ok: true });
});

app.post("/api/tasks/:id/subtasks/:sid/stop", (req, res) => {
  orch.stopSubtask(req.params.id, req.params.sid);
  res.json({ ok: true });
});

app.post("/api/tasks/:id/subtasks/:sid/retry", (req, res) => {
  const error = orch.retrySubtask(req.params.id, req.params.sid);
  if (error) { res.status(409).json({ error }); return; }
  res.json({ ok: true });
});

const dist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.PI_HOST || "127.0.0.1";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
if (!LOCAL_HOSTS.has(HOST) && process.env.PI_ALLOW_PUBLIC !== "1") {
  console.error(
    "拒绝绑定到非本机地址 " + HOST + "：本服务单用户、无鉴权，直接暴露到网络有风险。" +
      "如确有需要，请设置 PI_ALLOW_PUBLIC=1，并在前面加鉴权/反向代理。"
  );
  process.exit(1);
}
app.listen(PORT, HOST, () => {
  console.log("pi product server running at http://" + HOST + ":" + PORT + "（仅本机绑定，无内置鉴权）");
});