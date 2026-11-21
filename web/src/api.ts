import type { Task, TaskMode, TaskSummary } from "./types";

async function errorMessage(r: Response, fallback: string): Promise<string> {
  try {
    const j = await r.json();
    return String((j && j.error) || fallback);
  } catch {
    return fallback + " (" + r.status + ")";
  }
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
  providers: string[];
}

export async function startTask(goal: string, mode: TaskMode, scope?: string): Promise<{ taskId: string; task: Task }> {
  const r = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, mode, scope })
  });
  if (!r.ok) throw new Error("start task failed: " + r.status);
  return r.json();
}

export async function listTasks(): Promise<TaskSummary[]> {
  const r = await fetch("/api/tasks");
  if (!r.ok) throw new Error("list tasks failed: " + r.status);
  return r.json();
}

export async function getTask(id: string): Promise<Task> {
  const r = await fetch("/api/tasks/" + id);
  if (!r.ok) throw new Error("get task failed: " + r.status);
  return r.json();
}

export async function pickCandidate(taskId: string, candidateId: string): Promise<void> {
  const r = await fetch("/api/tasks/" + taskId + "/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId })
  });
  if (!r.ok) throw new Error(await errorMessage(r, "pick candidate failed"));
}

export async function stopSubtask(taskId: string, sid: string): Promise<void> {
  await fetch("/api/tasks/" + taskId + "/subtasks/" + sid + "/stop", { method: "POST" });
}

export async function retrySubtask(taskId: string, sid: string): Promise<void> {
  const r = await fetch("/api/tasks/" + taskId + "/subtasks/" + sid + "/retry", { method: "POST" });
  if (!r.ok) throw new Error(await errorMessage(r, "retry failed"));
}

export async function getSettings(): Promise<PublicSettings> {
  const r = await fetch("/api/settings");
  if (!r.ok) throw new Error("get settings failed: " + r.status);
  return r.json();
}

export async function saveSettings(patch: Record<string, unknown>): Promise<PublicSettings> {
  const r = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!r.ok) throw new Error("save settings failed: " + r.status);
  return r.json();
}


export async function testSettings(payload: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const r = await fetch("/api/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) return { ok: false, message: "测试请求失败: " + r.status };
  return r.json();
}
export interface EvalCase { id: string; dataset: string; goal: string; expect: string[]; tags?: string[]; }
export interface EvalCaseResult {
  caseId: string; goal: string; expect: string[]; actual: string | null; confidence: string;
  matched: string[]; missed: string[]; score: number; passed: boolean;
  method?: "llm" | "keyword"; judgeReason?: string; usd: number; ms: number;
}
export interface EvalSummary { total: number; passed: number; passRate: number; avgScore: number; totalUsd: number; avgMs: number; }
export interface EvalRun { id: string; dataset: string; createdAt: number; summary: EvalSummary; results: EvalCaseResult[]; }

export async function getEvalCases(dataset?: string): Promise<EvalCase[]> {
  const url = "/api/eval/cases" + (dataset ? "?dataset=" + encodeURIComponent(dataset) : "");
  const r = await fetch(url);
  if (!r.ok) return [];
  return r.json();
}

export async function getEvalRuns(): Promise<EvalRun[]> {
  const r = await fetch("/api/eval/runs");
  if (!r.ok) return [];
  return r.json();
}

export async function runEval(dataset: string): Promise<EvalRun> {
  const r = await fetch("/api/eval/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset })
  });
  if (!r.ok) throw new Error("run eval failed: " + r.status);
  return r.json();
}

export async function addEvalCase(payload: { goal: string; expect: string[]; dataset?: string; tags?: string[] }): Promise<EvalCase> {
  const r = await fetch("/api/eval/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error("add case failed: " + r.status);
  return r.json();
}
export interface DocSummary { id: string; name: string; source: string | null; versions: number; latestVersion: number; createdAt: number; updatedAt: number; }
export interface DocVersionMeta { version: number; contentHash: string; note: string | null; createdAt: number; chars: number; }
export interface DocDetail { document: DocSummary; versions: DocVersionMeta[]; }

export async function getDocuments(): Promise<DocSummary[]> {
  const r = await fetch("/api/data/documents");
  if (!r.ok) return [];
  return r.json();
}
export async function importDocument(payload: { name: string; source?: string; content: string; note?: string }): Promise<{ documentId: string; version: number; unchanged: boolean }> {
  const r = await fetch("/api/data/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("import failed: " + r.status);
  return r.json();
}
export async function getDocument(id: string): Promise<DocDetail> {
  const r = await fetch("/api/data/documents/" + id);
  if (!r.ok) throw new Error("get doc failed: " + r.status);
  return r.json();
}
export async function getVersionContent(id: string, version: number): Promise<{ content: string; contentHash: string; note: string | null; createdAt: number }> {
  const r = await fetch("/api/data/documents/" + id + "/versions/" + version);
  if (!r.ok) throw new Error("get version failed: " + r.status);
  return r.json();
}
export async function addDocVersion(id: string, content: string, note?: string): Promise<{ version: number; unchanged: boolean }> {
  const r = await fetch("/api/data/documents/" + id + "/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, note }) });
  if (!r.ok) throw new Error("add version failed: " + r.status);
  return r.json();
}
export async function deleteDocument(id: string): Promise<void> {
  await fetch("/api/data/documents/" + id, { method: "DELETE" });
}
export interface DiscoverResult { ok: boolean; models?: { id: string; name?: string }[]; message?: string; }
export async function discoverModels(payload: { provider: string; apiKey?: string; baseUrl?: string }): Promise<DiscoverResult> {
  const r = await fetch("/api/settings/models/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) return { ok: false, message: "请求失败: " + r.status };
  return r.json();
}

export interface TrendPoint { id: string; dataset: string; createdAt: number; passRate: number; avgScore: number; totalUsd: number; avgMs: number; }
export async function getEvalTrends(limit = 30): Promise<TrendPoint[]> {
  const r = await fetch("/api/eval/trends?limit=" + limit);
  if (!r.ok) return [];
  return r.json();
}
