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
  relayPreflight: boolean;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  requestTimeoutMs: number;
  providers: string[];
}

export interface RelayHealth {
  ok: boolean;
  reachable: boolean;
  authOk: boolean;
  stage: string;
  url: string;
  latencyMs: number;
  message: string;
  mode?: string;
  modelCount?: number;
}

export async function getRelayHealth(totalTimeoutMs?: number): Promise<RelayHealth> {
  const q = totalTimeoutMs ? "?totalTimeoutMs=" + totalTimeoutMs : "";
  const r = await fetch("/api/health/relay" + q);
  if (!r.ok) return { ok: false, reachable: false, authOk: false, stage: "http", url: "", latencyMs: 0, message: "健康检查请求失败: " + r.status };
  return r.json();
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
export type RepeatAggregation = "average" | "all" | "majority";
export interface EvalRepeatResult {
  index: number; actual: string | null; confidence: string; score: number; passed: boolean;
  agentScore: number; agentPassed: boolean; judgeScore?: number; judgePassed?: boolean; judgeReason?: string;
  matched: string[]; missed: string[]; usd: number; ms: number; status: string; failureReason?: string;
  method: "llm" | "keyword"; materialVersion?: string; workspaceFingerprint?: string; terminalReason?: string;
}
export interface EvalCaseResult {
  caseId: string; goal: string; expect: string[]; actual: string | null; confidence: string;
  matched: string[]; missed: string[]; score: number; passed: boolean;
  method?: "llm" | "keyword"; judgeReason?: string; usd: number; ms: number;
  agentScore?: number; agentPassed?: boolean; judgeScore?: number; judgePassed?: boolean; repeats?: number;
  aggregation?: RepeatAggregation; passCount?: number; representativeIndex?: number; actualSource?: "best" | "last";
  repeatResults?: EvalRepeatResult[];
}
export interface EvalSummary {
  total: number; sampleSize?: number; passed: number; passRate: number; avgScore: number;
  scoreStdev?: number; passRateCi95?: [number, number]; totalUsd: number; avgMs: number;
  byTag?: Record<string, { total: number; passed: number; passRate: number }>;
  outcomes?: { passed: number; failed: number; inconclusive: number; timeout: number; guarded: number };
}
export interface EvalRunMeta {
  engine?: string; provider?: string; modelId?: string; judgeModelId?: string; temperature?: number;
  repeats?: number; aggregation?: RepeatAggregation; promptVersions?: { judge?: string }; createdBy?: string; startedAt?: number; finishedAt?: number; notes?: string;
}
export interface EvalRun { id: string; dataset: string; createdAt: number; repeats?: number; aggregation?: RepeatAggregation; meta?: EvalRunMeta; summary: EvalSummary; results: EvalCaseResult[]; }


export interface StabilityRound { id: string; name: string; startedAt: string; finishedAt: string; total: number; passed: number; passRate: number; meanScore: number; avgLatencyMs: number; costUsd: number; errored: number; }
export interface StabilityCase { caseId: string; rounds: number; passedCount: number; passRate: number; scoreMean: number; scoreStdev: number; flips: number; emptyCount: number; statuses: string[]; failureCategories: string[]; }
export interface StabilityAcceptance { name: string; value: number; threshold: number; pass: boolean; op: string; }
export interface StabilityResult {
  available: boolean; reason?: string; dbPath: string; subject: string; version: string; generatedAt: number;
  rounds: StabilityRound[]; cases: StabilityCase[];
  accuracy: { units: number; passed: number; passRate: number; passRateCi95: [number, number]; meanScore: number };
  stability: { meanCasePassRate: number; casesWithFlip: number; flipRate: number; meanScoreStdev: number; emptyConclusionRate: number };
  infra: { infraUnits: number; infraErrorRate: number; relay: number; timeout: number; cost: number; parseFailure: number; guarded: number; inconclusive: number };
  failureTypes: Record<string, number>;
  resources: { avgLatencyMs: number; p50LatencyMs: number; p95LatencyMs: number; avgTokens: number; totalTokens: number; avgCostUsd: number; totalCostUsd: number };
  acceptance: StabilityAcceptance[];
}
export async function getStability(subject?: string, version?: string): Promise<StabilityResult | null> {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  if (version) q.set("version", version);
  const r = await fetch("/api/eval/stability" + (q.toString() ? "?" + q.toString() : ""));
  if (!r.ok) return null;
  return r.json();
}

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

export async function runEval(dataset: string, repeats = 1, aggregation: RepeatAggregation = "majority"): Promise<EvalRun> {
  const r = await fetch("/api/eval/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset, repeats, aggregation })
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

export interface AuthorityRun {
  runImportId: string; evalRunId: string; subjectVersion: string; matchStatus: string;
  total: number; passed: number; passRate: number; meanScore: number; importedAt: string;
}
export interface AuthorityRelease {
  releaseNo: string; id: string; datasetVersionId: string; caseCount: number;
  fingerprint: string; agentVersion: string; publishedAt: string; runs: AuthorityRun[];
}
export interface AuthorityFailure { id: string; releaseNo: string; caseId: string; category: string; verdict: string; rootCause: string; }
export interface EvalDbInfo { path: string; available: boolean; runCount: number; hasR003: boolean; }
export interface AuthoritySummary {
  available: boolean; authoritative: boolean; source: string; reason?: string; generatedAt: number;
  releases: AuthorityRelease[]; openFailures: AuthorityFailure[]; pendingImports: number;
  evalDb?: EvalDbInfo;
  totals: { releases: number; runImports: number; openFailures: number };
}

export interface AuthMaterialVersion { id: string; versionNo: number; status: string; contentSha256: string; effectiveDate: string; ingestedAt: string; notes: string; }
export interface AuthMaterial {
  id: string; title: string; sourceType: string; sourceRef: string; originalFilename: string;
  mime: string; sizeBytes: number; sha256Original: string; createdAt: string; versions: AuthMaterialVersion[];
}
export interface AuthorityMaterialsResult { available: boolean; authoritative: boolean; source: string; reason?: string; materials: AuthMaterial[]; }
export interface AuthCaseVersion { id: string; versionNo: number; status: string; input: unknown; expected: unknown; tags: string[]; basisSummary: string; contentSha256: string; createdAt: string; publishedAt: string; }
export interface AuthCase { id: string; title: string; sceneTag: string; currentVersionId: string; createdAt: string; versions: AuthCaseVersion[]; }
export interface AuthorityCasesResult { available: boolean; authoritative: boolean; source: string; reason?: string; cases: AuthCase[]; }
export interface AuthorityReleasesResult { available: boolean; authoritative: boolean; source: string; reason?: string; releases: AuthorityRelease[]; }
export interface AuthDatasetItem { seq: number; caseId: string; caseVersionId: string; versionNo: number; status: string; title: string; tags: string[]; }
export interface AuthorityDatasetResult {
  available: boolean; authoritative: boolean; source: string; reason?: string; versionId: string;
  dataset?: { id: string; name: string; description: string };
  version?: { id: string; datasetId: string; versionNo: number; status: string; caseCount: number; fingerprint: string; operators: string[]; createdAt: string; publishedAt: string };
  items: AuthDatasetItem[];
}
async function getJson<T>(url: string, fallback: T): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) return fallback;
  return r.json();
}
export function getAuthorityMaterials(): Promise<AuthorityMaterialsResult> {
  return getJson("/api/authority/materials", { available: false, authoritative: true, source: "", reason: "请求失败", materials: [] });
}
export function getAuthorityCases(): Promise<AuthorityCasesResult> {
  return getJson("/api/authority/cases", { available: false, authoritative: true, source: "", reason: "请求失败", cases: [] });
}
export function getAuthorityReleases(): Promise<AuthorityReleasesResult> {
  return getJson("/api/authority/releases", { available: false, authoritative: true, source: "", reason: "请求失败", releases: [] });
}
export function getAuthorityDataset(id: string): Promise<AuthorityDatasetResult> {
  return getJson("/api/authority/datasets/" + encodeURIComponent(id), { available: false, authoritative: true, source: "", reason: "请求失败", versionId: id, items: [] });
}

export async function getAuthority(): Promise<AuthoritySummary> {
  const r = await fetch("/api/authority/summary");
  if (!r.ok) return { available: false, authoritative: true, source: "", reason: "请求失败 " + r.status, generatedAt: Date.now(), releases: [], openFailures: [], pendingImports: 0, totals: { releases: 0, runImports: 0, openFailures: 0 } };
  return r.json();
}
