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

export type RepeatAggregation = "average" | "all" | "majority";

/** 单次重复运行的完整结果：逐次保留，避免「平均分来自多次、展示答案只来自最后一次」。 */
export interface EvalRepeatResult {
  index: number;
  actual: string | null;
  confidence: string;
  score: number;
  passed: boolean;
  agentScore: number;
  agentPassed: boolean;
  judgeScore?: number;
  judgePassed?: boolean;
  judgeReason?: string;
  matched: string[];
  missed: string[];
  usd: number;
  ms: number;
  status: string;
  failureReason?: string;
  method: "llm" | "keyword";
  materialVersion?: string;
  workspaceFingerprint?: string;
  terminalReason?: string;
  runMode?: string;
  failureStage?: string;
  tokens?: number;
  /** 重试前的初始结论（可能为空） */
  initialRootCause?: string | null;
  /** 重试前的任务状态 */
  initialStatus?: string;
  /** 重试前是否为空结论 */
  initialEmpty?: boolean;
  /** 本次重复是否因空结论触发重跑（0/1） */
  retryCount?: number;
  /** 本次重复是否靠重试恢复出结论 */
  retryRecovered?: boolean;
}

export interface EvalCaseResult {
  caseId: string;
  goal: string;
  expect: string[];
  actual: string | null;
  confidence: string;
  matched: string[];
  missed: string[];
  /** 最终分（裁判分优先，裁判不可用时为关键词分） */
  score: number;
  passed: boolean;
  method: "llm" | "keyword";
  /** 关键词（agent 自评对 rubic 关键词）分，与裁判分分离记录，用于区分「agent 答错」与「裁判抖动」 */
  agentScore: number;
  agentPassed: boolean;
  /** 裁判分（若用 LLM 裁判） */
  judgeScore?: number;
  judgePassed?: boolean;
  judgeReason?: string;
  materialVersion?: string;
  workspaceFingerprint?: string;
  usd: number;
  ms: number;
  /** 该用例重复次数（repeats） */
  repeats?: number;
  /** 任务最终状态（done/inconclusive/timeout/failed/stopped），用于结果分布统计 */
  taskStatus?: string;
  /** 任务终态原因（护栏/模型作答/运行失败/超时/用户停止） */
  terminalReason?: string;
  /** 逐次重复的完整结果；最后一次不会覆盖前几次 */
  repeatResults?: EvalRepeatResult[];
  /** 通过聚合规则 */
  aggregation?: RepeatAggregation;
  /** 重复中通过的次数 */
  passCount?: number;
  /** 代表答案取自第几次（0 基，按最高分选） */
  representativeIndex?: number;
  /** 代表答案来源标记 */
  actualSource?: "best" | "last";
  /** 本次用例的运行模式（real/mock/degraded/historical） */
  runMode?: string;
  /** 失败发生在哪个阶段（preflight/timeout/subtask/adjudicate...） */
  failureStage?: string;
  /** 失败归类：relay/timeout/cost/judge/agent/guard/inconclusive */
  failureCategory?: string;
  /** 本用例累计 token 数 */
  tokens?: number;
  /** 重试前的初始任务状态 */
  initialStatus?: string;
  /** 重试前的初始结论（可能为空） */
  initialRootCause?: string | null;
  /** 最终结论 */
  finalRootCause?: string | null;
  /** 首次（重试前）是否为空结论 */
  initialEmpty?: boolean;
  /** 因空结论触发重跑的次数 */
  retryCount?: number;
  /** 是否靠重试恢复出结论 */
  retryRecovered?: boolean;
  /** 是否由「首次空结论 + 重试」恢复（= initialEmpty && !!finalRootCause） */
  recoveredByRetry?: boolean;
  tags?: string[];
}

export interface EvalSummary {
  total: number;
  /** 样本数（= total，显式给出，避免只报百分比） */
  sampleSize: number;
  passed: number;
  passRate: number;
  avgScore: number;
  /** 用例得分的样本标准差，衡量稳定性 */
  scoreStdev: number;
  /** 通过率的 95% 置信区间（Wilson，按用例数） */
  passRateCi95: [number, number];
  totalUsd: number;
  avgMs: number;
  byTag?: Record<string, { total: number; passed: number; passRate: number }>;
  /** 结果分布：通过 / 执行失败 / 无证据(inconclusive) / 超时 / 安全护栏 */
  outcomes?: { passed: number; failed: number; inconclusive: number; timeout: number; guarded: number };
}

export interface EvalRunMeta {
  engine: "mock" | "pi";
  provider: string;
  modelId: string;
  judgeModelId?: string;
  temperature?: number;
  repeats: number;
  aggregation: RepeatAggregation;
  promptVersions: { judge: string };
  createdBy: string;
  startedAt: number;
  finishedAt: number;
  notes?: string;
}

export interface EvalRun {
  id: string;
  dataset: string;
  createdAt: number;
  repeats?: number;
  aggregation?: RepeatAggregation;
  meta?: EvalRunMeta;
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

/** 把失败阶段/终态归类，确保「中转/超时等基础设施失败」与「agent 能力失败」分开统计。 */
export function failureCategoryOf(stage?: string, terminal?: string): string | undefined {
  if (!stage && !terminal) return undefined;
  if (terminal && terminal.startsWith("guard_")) return "guard";
  if (terminal === "no_material") return "inconclusive";
  if (stage === "preflight") return "relay";
  if (stage === "timeout" || stage === "deadline" || stage === "watchdog") return "timeout";
  if (stage === "cost") return "cost";
  if (stage === "adjudicate") return "judge";
  if (stage === "subtask" || stage === "runtime") return "agent";
  return stage ? "other" : undefined;
}

/** 重复通过聚合规则：average=平均分≥0.5；all=全部通过；majority=多数通过（严格过半）。 */
export function aggregateRepeats(passCount: number, total: number, meanScore: number, rule: RepeatAggregation): boolean {
  if (total <= 0) return false;
  if (rule === "all") return passCount === total;
  if (rule === "average") return meanScore >= 0.5;
  return passCount * 2 > total;
}

function wilsonCi(passed: number, total: number, z = 1.96): [number, number] {
  if (total <= 0) return [0, 0];
  const p = passed / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** 统一统计口径：样本数、标准差、Wilson 95% 置信区间、按标签分组。 */
export function computeSummary(results: EvalCaseResult[]): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const scores = results.map((r) => r.score);
  const avgScore = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
  const variance = total > 1 ? scores.reduce((a, b) => a + (b - avgScore) * (b - avgScore), 0) / (total - 1) : 0;
  const scoreStdev = Math.sqrt(Math.max(0, variance));
  const totalUsd = results.reduce((a, r) => a + r.usd, 0);
  const avgMs = total > 0 ? Math.round(results.reduce((a, r) => a + r.ms, 0) / total) : 0;
  const byTag: Record<string, { total: number; passed: number; passRate: number }> = {};
  for (const r of results) {
    for (const t of r.tags || []) {
      if (!byTag[t]) byTag[t] = { total: 0, passed: 0, passRate: 0 };
      byTag[t].total++;
      if (r.passed) byTag[t].passed++;
    }
  }
  for (const k of Object.keys(byTag)) byTag[k].passRate = byTag[k].total ? byTag[k].passed / byTag[k].total : 0;
  // 结果分布：把「安全护栏 / 无证据 / 执行失败 / 超时 / 真通过」分开统计，
  // 避免把所有 done 都当成正常回答。no_material 在任务层是 inconclusive，故不计入 guarded。
  const outcomes = { passed: 0, failed: 0, inconclusive: 0, timeout: 0, guarded: 0 };
  for (const r of results) {
    if (r.taskStatus === "timeout") outcomes.timeout++;
    else if (r.taskStatus === "inconclusive") outcomes.inconclusive++;
    else if (r.terminalReason && r.terminalReason.startsWith("guard_")) outcomes.guarded++;
    else if (r.passed) outcomes.passed++;
    else outcomes.failed++;
  }
  return {
    total,
    sampleSize: total,
    passed,
    passRate: total > 0 ? passed / total : 0,
    avgScore,
    scoreStdev,
    passRateCi95: wilsonCi(passed, total),
    totalUsd,
    avgMs,
    byTag,
    outcomes
  };
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

  async run(
    dataset: string,
    orch: Orchestrator,
    judge?: (c: EvalCase, actual: string | null) => Promise<{ score: number; passed: boolean; reason: string } | null>,
    opts?: { repeats?: number; aggregation?: RepeatAggregation; meta?: Partial<EvalRunMeta> }
  ): Promise<EvalRun> {
    const cases = this.listCases(dataset);
    const repeats = Math.max(1, Math.min(10, Math.round(opts?.repeats || 1)));
    const aggregation: RepeatAggregation = opts?.aggregation === "average" || opts?.aggregation === "all" || opts?.aggregation === "majority"
      ? opts.aggregation
      : "majority";
    const startedAt = Date.now();
    const results: EvalCaseResult[] = [];
    for (const c of cases) {
      const repeatResults: EvalRepeatResult[] = [];
      let caseMs = 0;
      let caseUsd = 0;
      for (let i = 0; i < repeats; i++) {
        const t0 = Date.now();
        let task = await orch.runToCompletion({ goal: c.goal, mode: "diagnose", workspace: c.workspace });
        // 空结论重试指标：先记重试前的初始状态/结论
        const initialRootCause = task.verdict ? task.verdict.rootCause : null;
        const initialStatus = task.status;
        const initialEmpty = !initialRootCause;
        let actual = initialRootCause;
        let retryCount = 0;
        if (initialEmpty) {
          // 稳定性：空结论自动重跑一次
          retryCount = 1;
          try {
            const t2 = await orch.runToCompletion({ goal: c.goal, mode: "diagnose", workspace: c.workspace });
            if (t2.verdict && t2.verdict.rootCause) { task = t2; actual = t2.verdict.rootCause; }
          } catch { /* ignore */ }
        }
        const retryRecovered = initialEmpty && !!actual;
        const confidence = task.verdict ? task.verdict.confidence : "inconclusive";
        const sc = scoreCase(c.expect, actual);
        let score = sc.score, passed = sc.passed, method: "llm" | "keyword" = "keyword", judgeReason: string | undefined, judgeScore: number | undefined, judgePassed: boolean | undefined;
        if (judge) {
          try {
            const j = await judge(c, actual);
            if (j) { judgeScore = j.score; judgePassed = j.passed; score = j.score; passed = j.passed; method = "llm"; judgeReason = j.reason; }
          } catch { /* fallback keyword */ }
        }
        const runMs = Date.now() - t0;
        const runUsd = task.spentUsd || 0;
        caseMs += runMs;
        caseUsd += runUsd;
        repeatResults.push({
          index: i,
          actual,
          confidence,
          score,
          passed,
          agentScore: sc.score,
          agentPassed: sc.passed,
          judgeScore,
          judgePassed,
          judgeReason,
          matched: sc.matched,
          missed: sc.missed,
          usd: runUsd,
          ms: runMs,
          status: task.status,
          failureReason: task.failureReason,
          method,
          materialVersion: task.materialVersion,
          workspaceFingerprint: task.workspaceFingerprint,
          terminalReason: task.terminalReason,
          runMode: task.runMode,
          failureStage: task.failureStage,
          tokens: task.spentTokens || 0,
          initialRootCause,
          initialStatus,
          initialEmpty,
          retryCount,
          retryRecovered
        });
      }
      const meanScore = repeatResults.length ? repeatResults.reduce((a, b) => a + b.score, 0) / repeatResults.length : 0;
      const passCount = repeatResults.filter((r) => r.passed).length;
      const passed = aggregateRepeats(passCount, repeatResults.length, meanScore, aggregation);
      // 代表答案取「最高分的那一次」，并显式标注来源，避免用最后一次覆盖统计口径
      let repIndex = 0;
      for (let i = 1; i < repeatResults.length; i++) {
        if (repeatResults[i].score > repeatResults[repIndex].score) repIndex = i;
      }
      const rep: EvalRepeatResult | undefined = repeatResults[repIndex];
      // 空结论重试的用例级汇总
      const initialEmpty = repeatResults.some((r) => r.initialEmpty === true);
      const retryCount = repeatResults.reduce((a, r) => a + (r.retryCount || 0), 0);
      const initialRootCause = repeatResults.length ? (repeatResults[0].initialRootCause ?? null) : null;
      const initialStatus = repeatResults.length ? repeatResults[0].initialStatus : undefined;
      const finalRootCause = rep ? rep.actual : null;
      const retryRecovered = repeatResults.some((r) => r.retryRecovered === true);
      const recoveredByRetry = initialEmpty && !!finalRootCause;
      const meanOf = (vals: (number | undefined)[]): number | undefined => {
        const xs = vals.filter((v): v is number => typeof v === "number");
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
      };
      results.push({
        caseId: c.id,
        goal: c.goal,
        expect: c.expect,
        actual: rep ? rep.actual : null,
        confidence: rep ? rep.confidence : "inconclusive",
        matched: rep ? rep.matched : [],
        missed: rep ? rep.missed : c.expect.slice(),
        score: meanScore,
        passed,
        method: rep ? rep.method : "keyword",
        agentScore: meanOf(repeatResults.map((r) => r.agentScore)) ?? 0,
        agentPassed: repeatResults.length > 0 && repeatResults.every((r) => r.agentPassed),
        judgeScore: meanOf(repeatResults.map((r) => r.judgeScore)),
        judgePassed: repeatResults.length > 0 && repeatResults.every((r) => r.judgePassed === true),
        judgeReason: rep ? rep.judgeReason : undefined,
        materialVersion: rep ? rep.materialVersion : undefined,
        workspaceFingerprint: rep ? rep.workspaceFingerprint : undefined,
        taskStatus: rep ? rep.status : undefined,
        terminalReason: rep ? rep.terminalReason : undefined,
        runMode: rep ? rep.runMode : undefined,
        failureStage: rep ? rep.failureStage : undefined,
        failureCategory: failureCategoryOf(rep ? rep.failureStage : undefined, rep ? rep.terminalReason : undefined),
        tokens: repeatResults.reduce((a, r) => a + (r.tokens || 0), 0),
        initialStatus,
        initialRootCause,
        finalRootCause,
        initialEmpty,
        retryCount,
        retryRecovered,
        recoveredByRetry,
        usd: caseUsd,
        ms: Math.round(caseMs / repeats),
        repeats,
        aggregation,
        passCount,
        representativeIndex: repIndex,
        actualSource: "best",
        repeatResults,
        tags: c.tags
      });
    }
    const summary = computeSummary(results);
    const finishedAt = Date.now();
    const meta: EvalRunMeta = {
      engine: opts?.meta?.engine || "mock",
      provider: opts?.meta?.provider || "",
      modelId: opts?.meta?.modelId || "",
      judgeModelId: opts?.meta?.judgeModelId,
      temperature: opts?.meta?.temperature,
      repeats,
      aggregation,
      promptVersions: opts?.meta?.promptVersions || { judge: "judge-v1" },
      createdBy: opts?.meta?.createdBy || "local",
      startedAt,
      finishedAt,
      notes: opts?.meta?.notes
    };
    const run: EvalRun = {
      id: "eval_" + finishedAt.toString(36),
      dataset,
      createdAt: finishedAt,
      repeats,
      aggregation,
      meta,
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
  const results = run.results.map((r) => {
    // 基础设施失败（中转/超时/费用）记为 error，不混入 agent 能力指标
    const infra = r.failureCategory === "relay" || r.failureCategory === "timeout" || r.failureCategory === "cost";
    const status = infra ? "error" : (r.passed ? "passed" : "failed");
    return {
      case_id: r.caseId,
      status,
      score: r.score,
      scores: [{ operator: "root_cause_keywords", score: r.score, passed: r.passed, detail: { matched: r.matched, missed: r.missed } }],
      subject: {
        output: {
          rootCause: r.actual,
          confidence: r.confidence,
          materialVersion: r.materialVersion || null,
          workspaceFingerprint: r.workspaceFingerprint || null,
          runMode: r.runMode || null,
          failureStage: r.failureStage || null,
          failureCategory: r.failureCategory || null,
        },
        error: infra ? (r.failureStage || "infrastructure_failure") : null,
        latency_ms: r.ms,
        cost_usd: r.usd,
        tokens_in: null,
        tokens_out: r.tokens == null ? null : r.tokens,
        meta: {
          failureStage: r.failureStage || null,
          failureCategory: r.failureCategory || null,
          taskStatus: r.taskStatus || null,
          terminalReason: r.terminalReason || null,
          initialEmpty: r.initialEmpty === true,
          retryCount: r.retryCount || 0,
          retryRecovered: r.retryRecovered === true,
          initialStatus: r.initialStatus || null,
          initialRootCause: r.initialRootCause ?? null,
          finalRootCause: r.finalRootCause ?? null,
          recoveredByRetry: r.recoveredByRetry === true,
        }
      },
      tags: [],
      error: infra ? (r.failureStage || "infrastructure_failure") : null
    };
  });
  const passed = results.filter((x) => x.status === "passed").length;
  const failed = results.filter((x) => x.status === "failed").length;
  const errored = results.filter((x) => x.status === "error").length;
  const metrics = {
    total: run.summary.total,
    graded: run.summary.total,
    passed,
    failed,
    errored,
    pass_rate: run.summary.total ? passed / run.summary.total : 0,
    mean_score: run.summary.avgScore,
    avg_latency_ms: run.summary.avgMs,
    total_cost_usd: run.summary.totalUsd,
    per_operator: { root_cause_keywords: { applied: run.summary.total, passed, pass_rate: run.summary.total ? passed / run.summary.total : 0, mean_score: run.summary.avgScore } },
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