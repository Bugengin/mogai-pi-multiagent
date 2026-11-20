import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Orchestrator } from "./orchestrator";
import { Store } from "./store";
import { DataStore } from "./dataStore";
import { SettingsStore, KNOWN_PROVIDERS } from "./settings";
import { testConnection, judgeAnswer } from "./piEngine";
import { discoverModels } from "./modelDiscovery";
import { EvalService, toEvalplatReport, toEvalplatDataset } from "./evalService";

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

app.get("/api/health", (_req, res) => {
  const s = settingsStore.publicSettings();
  res.json({ ok: true, engine: s.engine, db: "sqlite", ts: Date.now() });
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
    const run = await evalService.run(dataset, orch, judge);
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
      output: { rootCause: task.verdict ? task.verdict.rootCause : null, confidence: task.verdict ? task.verdict.confidence : "inconclusive" },
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
  orch.pickCandidate(req.params.id, candidateId);
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

app.post("/api/tasks/:id/subtasks/:sid/stop", (req, res) => {
  orch.stopSubtask(req.params.id, req.params.sid);
  res.json({ ok: true });
});

app.post("/api/tasks/:id/subtasks/:sid/retry", (req, res) => {
  orch.retrySubtask(req.params.id, req.params.sid);
  res.json({ ok: true });
});

const dist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, "127.0.0.1", () => {
  console.log("pi product server running at http://127.0.0.1:" + PORT);
});