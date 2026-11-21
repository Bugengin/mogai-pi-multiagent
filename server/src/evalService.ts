import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Orchestrator } from "./orchestrator";

export interface EvalCase {
  id: string;
  dataset: string;
  goal: string;
  expect: string[];
  rubric?: string;
  workspace?: string;
  tags?: string[];
}

export interface EvalCaseResult {
  caseId: string;
  goal: string;
  expect: string[];
  actual: string | null;
  confidence: string;
  matched: string[];
  missed: string[];
  score: number;
  passed: boolean;
  method: "llm" | "keyword";
  judgeReason?: string;
  materialVersion?: string;
  workspaceFingerprint?: string;
  usd: number;
  ms: number;
}

export interface EvalSummary {
  total: number;
  passed: number;
  passRate: number;
  avgScore: number;
  totalUsd: number;
  avgMs: number;
}

export interface EvalRun {
  id: string;
  dataset: string;
  createdAt: number;
  summary: EvalSummary;
  results: EvalCaseResult[];
}

const DEFAULT_CASES: EvalCase[] = [
  { id: "c_export", dataset: "demo", goal: "导出文件为空，帮我查一下原因", expect: ["PENDING", "查询", "0 行"], rubric: "根因是导出查询按 status=PENDING 过滤，而数据集中没有任何 PENDING 订单，导致查询返回 0 行、只写表头；写入层本身没有缺陷。", workspace: "export", tags: ["export"] },
  { id: "c_api500", dataset: "demo", goal: "线上接口偶尔返回 500，帮我定位原因", expect: ["handler", "ctx.user", "500"], rubric: "根因是 handler 未对可选值 ctx.user 判空就读取 user.id，当 ctx.user 缺失（未登录/会话过期）时抛 TypeError，导致接口 500。", workspace: "api500", tags: ["api"] },
  { id: "c_report", dataset: "demo", goal: "报表数据和明细对不上，帮我查是哪一步算错了", expect: ["时区", "日期", "错位"], rubric: "根因是 aggregate 用本地时区 getDate() 取日期，UTC+8 下跨日订单被归到错误日期，导致报表与明细对不上。", workspace: "report", tags: ["report"] }
];

export function scoreCase(expect: string[], actual: string | null): { matched: string[]; missed: string[]; score: number; passed: boolean } {
  if (!actual) return { matched: [], missed: expect.slice(), score: 0, passed: false };
  const matched = expect.filter((k) => actual.includes(k));
  const missed = expect.filter((k) => !actual.includes(k));
  const score = expect.length > 0 ? matched.length / expect.length : 1;
  return { matched, missed, score, passed: score >= 0.6 };
}

export class EvalService {
  private casesFile: string;
  private runsFile: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.casesFile = path.join(dataDir, "eval_cases.json");
    this.runsFile = path.join(dataDir, "eval_runs.json");
    this.ensureSeed();
  }

  private ensureSeed(): void {
    if (!fs.existsSync(this.casesFile)) {
      fs.writeFileSync(this.casesFile, JSON.stringify(DEFAULT_CASES, null, 2), "utf8");
    }
    if (!fs.existsSync(this.runsFile)) {
      fs.writeFileSync(this.runsFile, "[]", "utf8");
    }
  }

  listCases(dataset?: string): EvalCase[] {
    try {
      const all = JSON.parse(fs.readFileSync(this.casesFile, "utf8")) as EvalCase[];
      return dataset ? all.filter((c) => c.dataset === dataset) : all;
    } catch {
      return DEFAULT_CASES.slice();
    }
  }

  addCase(input: { goal: string; expect: string[]; dataset?: string; tags?: string[]; workspace?: string; rubric?: string }): EvalCase {
    const all = this.listCases();
    const c: EvalCase = {
      id: "c_" + Math.random().toString(36).slice(2, 8),
      dataset: input.dataset || "demo",
      goal: input.goal,
      expect: input.expect,
      rubric: input.rubric,
      workspace: input.workspace,
      tags: input.tags
    };
    all.push(c);
    fs.writeFileSync(this.casesFile, JSON.stringify(all, null, 2), "utf8");
    return c;
  }

  private loadRuns(): EvalRun[] {
    try { return JSON.parse(fs.readFileSync(this.runsFile, "utf8")) as EvalRun[]; } catch { return []; }
  }

  listRuns(limit = 20): EvalRun[] {
    return this.loadRuns().slice(0, limit);
  }

  getRun(id: string): EvalRun | undefined {
    return this.loadRuns().find((r) => r.id === id);
  }

  async run(dataset: string, orch: Orchestrator, judge?: (c: EvalCase, actual: string | null) => Promise<{ score: number; passed: boolean; reason: string } | null>): Promise<EvalRun> {
    const cases = this.listCases(dataset);
    const results: EvalCaseResult[] = [];
    for (const c of cases) {
      const started = Date.now();
      let task = await orch.runToCompletion({ goal: c.goal, mode: "diagnose", workspace: c.workspace });
      let actual = task.verdict ? task.verdict.rootCause : null;
      if (!actual) {
        // 稳定性：空结论自动重跑一次
        try {
          const t2 = await orch.runToCompletion({ goal: c.goal, mode: "diagnose", workspace: c.workspace });
          if (t2.verdict && t2.verdict.rootCause) { task = t2; actual = t2.verdict.rootCause; }
        } catch { /* ignore */ }
      }
      const ms = Date.now() - started;
      const confidence = task.verdict ? task.verdict.confidence : "inconclusive";
      const sc = scoreCase(c.expect, actual);
      let score = sc.score, passed = sc.passed, method: "llm" | "keyword" = "keyword", judgeReason: string | undefined;
      if (judge) {
        try {
          const j = await judge(c, actual);
          if (j) { score = j.score; passed = j.passed; method = "llm"; judgeReason = j.reason; }
        } catch { /* fallback keyword */ }
      }
      results.push({
        caseId: c.id,
        goal: c.goal,
        expect: c.expect,
        actual,
        confidence,
        matched: sc.matched,
        missed: sc.missed,
        score,
        passed,
        method,
        judgeReason,
        materialVersion: task.materialVersion,
        workspaceFingerprint: task.workspaceFingerprint,
        usd: task.spentUsd || 0,
        ms
      });
    }
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const totalUsd = results.reduce((a, r) => a + r.usd, 0);
    const avgMs = total > 0 ? Math.round(results.reduce((a, r) => a + r.ms, 0) / total) : 0;
    const summary: EvalSummary = {
      total,
      passed,
      passRate: total > 0 ? passed / total : 0,
      avgScore: total > 0 ? results.reduce((a, r) => a + r.score, 0) / total : 0,
      totalUsd,
      avgMs
    };
    const run: EvalRun = {
      id: "eval_" + Date.now().toString(36),
      dataset,
      createdAt: Date.now(),
      summary,
      results
    };
    const runs = this.loadRuns();
    runs.unshift(run);
    fs.writeFileSync(this.runsFile, JSON.stringify(runs.slice(0, 50), null, 2), "utf8");
    return run;
  }
}

/** 把本地评测结果映射成 evalplat 的 Run JSON 结构（与 evalplat export --format json 一致） */
export function toEvalplatReport(run: EvalRun, subjectName: string): unknown {
  const totalMs = run.results.reduce((a, r) => a + r.ms, 0);
  const finishedAt = new Date(run.createdAt).toISOString();
  const startedAt = new Date(run.createdAt - totalMs).toISOString();
  const datasetHash = createHash("sha256").update(run.results.map((r) => r.caseId + ":" + r.goal).join("|")).digest("hex");
  const results = run.results.map((r) => ({
    case_id: r.caseId,
    status: r.passed ? "passed" : "failed",
    score: r.score,
    scores: [{ operator: "root_cause_keywords", score: r.score, passed: r.passed, detail: { matched: r.matched, missed: r.missed } }],
    subject: {
      output: {
        rootCause: r.actual,
        confidence: r.confidence,
        materialVersion: r.materialVersion || null,
        workspaceFingerprint: r.workspaceFingerprint || null,
      },
      error: null,
      latency_ms: r.ms,
      cost_usd: r.usd,
      tokens_in: null,
      tokens_out: null,
      meta: {}
    },
    tags: [],
    error: null
  }));
  const metrics = {
    total: run.summary.total,
    graded: run.summary.total,
    passed: run.summary.passed,
    failed: run.summary.total - run.summary.passed,
    errored: 0,
    pass_rate: run.summary.passRate,
    mean_score: run.summary.avgScore,
    avg_latency_ms: run.summary.avgMs,
    total_cost_usd: run.summary.totalUsd,
    per_operator: { root_cause_keywords: { applied: run.summary.total, passed: run.summary.passed, pass_rate: run.summary.passRate, mean_score: run.summary.avgScore } },
    per_tag: {}
  };
  return {
    id: "evalplat_" + run.id,
    name: "多智能体诊断 · " + run.dataset,
    subject: subjectName,
    subject_version: "",
    dataset: run.dataset,
    dataset_hash: datasetHash,
    operators: ["root_cause_keywords"],
    material_versions: Array.from(new Set(run.results.map((r) => r.materialVersion).filter(Boolean))) as string[],
    started_at: startedAt,
    finished_at: finishedAt,
    metrics,
    meta: { source: "pi-multiagent", runId: run.id },
    results
  };
}

/** 把本地案例集映射成 evalplat 的 Dataset JSON（id/name/cases: input/expected/tags） */
export function toEvalplatDataset(cases: EvalCase[], dataset: string): unknown {
  return {
    id: dataset,
    name: "多智能体诊断 · " + dataset,
    cases: cases.map((c) => ({
      id: c.id,
      input: { goal: c.goal, workspace: c.workspace },
      expected: { rubric: c.rubric || "" },
      tags: c.tags || []
    }))
  };
}