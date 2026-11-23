import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * 真实引擎多轮稳定性：直接读评测中台结果库（evalplat.db）里同一 subject+version 的多条 run，
 * 按「轮 = 一条 run」聚合，计算通过率/置信区间/翻转/波动/成本/耗时与失败类型分布。
 * 只读，不修改评测库。
 */

export interface StabilityThresholds {
  minRounds: number;
  minPassRate: number;
  maxInfraErrorRate: number;
  maxFlipRate: number;
  maxP95Ms: number;
  maxAvgCostUsd: number;
}

const DEFAULT_THRESHOLDS: StabilityThresholds = {
  minRounds: 3,
  minPassRate: 0.5,
  maxInfraErrorRate: 0.02,
  maxFlipRate: 0.2,
  maxP95Ms: 90000,
  maxAvgCostUsd: 0.15
};

export interface StabilityOptions {
  dbPath: string;
  subject?: string;
  version?: string;
  thresholds?: Partial<StabilityThresholds>;
}

export interface StabilityRound {
  id: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  passed: number;
  passRate: number;
  meanScore: number;
  avgLatencyMs: number;
  costUsd: number;
  errored: number;
}

export interface StabilityCase {
  caseId: string;
  rounds: number;
  passedCount: number;
  passRate: number;
  scoreMean: number;
  scoreStdev: number;
  flips: number;
  emptyCount: number;
  /** 因首次空结论触发重跑的次数（旧数据为 0） */
  retryCount: number;
  /** 因重试而恢复（最终有结论）的次数（旧数据为 0） */
  retryRecovered: number;
  statuses: string[];
  failureCategories: string[];
}

export interface StabilityResult {
  available: boolean;
  reason?: string;
  dbPath: string;
  subject: string;
  version: string;
  generatedAt: number;
  rounds: StabilityRound[];
  cases: StabilityCase[];
  accuracy: { units: number; passed: number; passRate: number; passRateCi95: [number, number]; meanScore: number };
  stability: {
    meanCasePassRate: number;
    casesWithFlip: number;
    flipRate: number;
    meanScoreStdev: number;
    emptyConclusionRate: number;
    /** 首次（重试前）空结论的样本数 */
    initialEmptyCount: number;
    /** 因空结论触发重跑的总次数 */
    retryCount: number;
    /** 重试后恢复出结论的样本数 */
    retryRecoveredCount: number;
    /** 最终仍为空结论的样本数 */
    finalEmptyCount: number;
    /** 重试恢复率 = retryRecoveredCount / initialEmptyCount */
    retryRecoveryRate: number;
  };
  infra: { infraUnits: number; infraErrorRate: number; relay: number; timeout: number; cost: number; parseFailure: number; guarded: number; inconclusive: number };
  failureTypes: Record<string, number>;
  resources: {
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    avgTokens: number;
    totalTokens: number;
    avgCostUsd: number;
    totalCostUsd: number;
    /** 重试额外成本（估算）：retryCount × 单条均值（非精确计量） */
    retryExtraCostUsd: number;
    /** 重试额外耗时（估算）：retryCount × 平均单条耗时（非精确计量） */
    retryExtraMs: number;
  };
  thresholds: StabilityThresholds;
  acceptance: { name: string; value: number; threshold: number; pass: boolean; op: string }[];
}

function wilson(passed: number, total: number, z = 1.96): [number, number] {
  if (total <= 0) return [0, 0];
  const p = passed / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function pct(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((q / 100) * s.length) - 1));
  return s[idx];
}

function classifyFailure(status: string, meta: any, out: any): string {
  const stage = String(meta.failureStage || out.failureStage || "");
  const cat = String(meta.failureCategory || out.failureCategory || "");
  const terminal = String(meta.terminalReason || "");
  const confidence = String((out.verdict && out.verdict.confidence) || out.confidence || "");
  const taskStatus = String(meta.status || "");
  if (terminal.startsWith("guard_")) return "guarded";
  if (cat === "relay" || stage === "preflight" || stage === "connect" || stage === "read") return "relay_failure";
  if (cat === "timeout" || stage === "timeout" || stage === "deadline" || stage === "watchdog") return "timeout";
  if (cat === "judge" || stage === "adjudicate") return "judge_failure";
  if (cat === "cost" || stage === "cost") return "cost_failure";
  if (/json/i.test(String(meta.error || "")) || /parse/i.test(String(meta.failureReason || ""))) return "parse_failure";
  if (status === "passed") return "passed";
  if (confidence === "inconclusive" || taskStatus === "inconclusive") return "inconclusive";
  return "agent_bug";
}

export function computeStability(opts: StabilityOptions): StabilityResult {
  const subject = opts.subject || "pi-multiagent";
  const version = opts.version || "0.1.2-real";
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const empty: StabilityResult = {
    available: false,
    dbPath: opts.dbPath,
    subject,
    version,
    generatedAt: Date.now(),
    rounds: [],
    cases: [],
    accuracy: { units: 0, passed: 0, passRate: 0, passRateCi95: [0, 0], meanScore: 0 },
    stability: { meanCasePassRate: 0, casesWithFlip: 0, flipRate: 0, meanScoreStdev: 0, emptyConclusionRate: 0, initialEmptyCount: 0, retryCount: 0, retryRecoveredCount: 0, finalEmptyCount: 0, retryRecoveryRate: 0 },
    infra: { infraUnits: 0, infraErrorRate: 0, relay: 0, timeout: 0, cost: 0, parseFailure: 0, guarded: 0, inconclusive: 0 },
    failureTypes: {},
    resources: { avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, avgTokens: 0, totalTokens: 0, avgCostUsd: 0, totalCostUsd: 0, retryExtraCostUsd: 0, retryExtraMs: 0 },
    thresholds,
    acceptance: []
  };
  if (!opts.dbPath || !fs.existsSync(opts.dbPath)) {
    return { ...empty, reason: "未找到评测执行库（evalplat.db）" };
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(opts.dbPath, { readOnly: true });
  } catch (e) {
    return { ...empty, reason: "无法打开评测执行库：" + String(e).slice(0, 120) };
  }

  try {
    const runRows = db
      .prepare("SELECT id,name,started_at,finished_at,metrics,meta FROM runs WHERE subject=? AND subject_version=? ORDER BY COALESCE(finished_at,started_at)")
      .all(subject, version) as Record<string, unknown>[];
    if (runRows.length === 0) return { ...empty, reason: "没有符合条件的真实运行：" + subject + "@" + version };

    const rounds: StabilityRound[] = [];
    const caseAgg = new Map<string, { scores: number[]; passed: boolean[]; empty: number; initialEmpty: number; retryCount: number; retryRecovered: number; statuses: string[]; cats: string[]; order: number }>();
    const failureTypes: Record<string, number> = {};
    let units = 0, passedUnits = 0, scoreSum = 0;
    let relay = 0, timeout = 0, costCount = 0, parseFailure = 0, guarded = 0, inconclusive = 0;
    const latencies: number[] = [];
    let tokensSum = 0, costSum = 0, tokenUnits = 0;

    let order = 0;
    for (const rr of runRows) {
      const runId = String(rr.id);
      const details = db
        .prepare("SELECT case_id, status, score, latency_ms, detail FROM case_results WHERE run_id=? ORDER BY case_id")
        .all(runId) as Record<string, unknown>[];
      const parsed = details.map((d) => {
        let det: any = {};
        try { det = JSON.parse(String(d.detail || "{}")); } catch { det = {}; }
        return { row: d, det };
      });
      const roundPassed = parsed.filter((p) => p.row.status === "passed").length;
      const roundTotal = parsed.length;
      const roundScores = parsed.map((p) => Number(p.row.score || 0));
      const roundLat = parsed.map((p) => Number((p.det.subject && p.det.subject.latency_ms) || p.row.latency_ms || 0));
      const roundCost = parsed.reduce((a, p) => a + Number((p.det.subject && p.det.subject.cost_usd) || 0), 0);
      const roundErrored = parsed.filter((p) => p.row.status === "error").length;
      rounds.push({
        id: runId,
        name: String(rr.name || ""),
        startedAt: String(rr.started_at || ""),
        finishedAt: String(rr.finished_at || ""),
        total: roundTotal,
        passed: roundPassed,
        passRate: roundTotal ? roundPassed / roundTotal : 0,
        meanScore: roundScores.length ? roundScores.reduce((a, b) => a + b, 0) / roundScores.length : 0,
        avgLatencyMs: roundLat.length ? Math.round(roundLat.reduce((a, b) => a + b, 0) / roundLat.length) : 0,
        costUsd: Number(roundCost.toFixed(6)),
        errored: roundErrored
      });

      for (const { row, det } of parsed) {
        const caseId = String(row.case_id);
        const status = String(row.status || "");
        const score = Number(row.score || 0);
        const out = (det.subject && det.subject.output) || {};
        const meta = (det.subject && det.subject.meta) || {};
        const latency = Number((det.subject && det.subject.latency_ms) || row.latency_ms || 0);
        const tokens = Number((det.subject && det.subject.tokens_out) || 0) || 0;
        const cost = Number((det.subject && det.subject.cost_usd) || 0);
        const category = classifyFailure(status, meta, out);

        units++;
        if (status === "passed") passedUnits++;
        scoreSum += score;
        latencies.push(latency);
        tokensSum += tokens;
        if (tokens > 0) tokenUnits++;
        costSum += cost;
        if (category === "relay_failure") relay++;
        else if (category === "timeout") timeout++;
        else if (category === "cost_failure") costCount++;
        else if (category === "parse_failure") parseFailure++;
        else if (category === "guarded") guarded++;
        else if (category === "inconclusive") inconclusive++;
        failureTypes[category] = (failureTypes[category] || 0) + 1;

        let agg = caseAgg.get(caseId);
        if (!agg) {
          agg = { scores: [], passed: [], empty: 0, initialEmpty: 0, retryCount: 0, retryRecovered: 0, statuses: [], cats: [], order: order++ };
          caseAgg.set(caseId, agg);
        }
        agg.scores.push(score);
        agg.passed.push(status === "passed");
        agg.statuses.push(status);
        agg.cats.push(category);
        // 空结论重试指标：旧数据缺字段一律降级为 0
        agg.initialEmpty += meta.initialEmpty === true ? 1 : 0;
        agg.retryCount += Number(meta.retryCount || 0) || 0;
        agg.retryRecovered += meta.recoveredByRetry === true ? 1 : 0;
        const rc = out.verdict && out.verdict.rootCause;
        if (!rc) agg.empty++;
      }
    }

    const cases: StabilityCase[] = [];
    let flipTotal = 0, flipDenom = 0, casesWithFlip = 0, stdevSum = 0, casePassRateSum = 0;
    const sortedCases = Array.from(caseAgg.entries()).sort((a, b) => a[1].order - b[1].order);
    for (const [caseId, agg] of sortedCases) {
      const n = agg.passed.length;
      const pc = agg.passed.filter(Boolean).length;
      let flips = 0;
      for (let i = 1; i < agg.passed.length; i++) if (agg.passed[i] !== agg.passed[i - 1]) flips++;
      flipTotal += flips;
      flipDenom += Math.max(0, n - 1);
      if (flips > 0) casesWithFlip++;
      const mean = agg.scores.reduce((a, b) => a + b, 0) / n;
      const variance = n > 1 ? agg.scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1) : 0;
      const stdev = Math.sqrt(Math.max(0, variance));
      stdevSum += stdev;
      casePassRateSum += n ? pc / n : 0;
      cases.push({
        caseId,
        rounds: n,
        passedCount: pc,
        passRate: n ? pc / n : 0,
        scoreMean: Number(mean.toFixed(4)),
        scoreStdev: Number(stdev.toFixed(4)),
        flips,
        emptyCount: agg.empty,
        retryCount: agg.retryCount,
        retryRecovered: agg.retryRecovered,
        statuses: agg.statuses,
        failureCategories: agg.cats
      });
    }

    const overallPassRate = units ? passedUnits / units : 0;
    const infraUnits = relay + timeout + costCount + parseFailure;
    // 空结论重试汇总（旧数据缺字段为 0）
    const initialEmptyCount = sortedCases.reduce((a, [, ag]) => a + ag.initialEmpty, 0);
    const retryTotal = sortedCases.reduce((a, [, ag]) => a + ag.retryCount, 0);
    const retryRecoveredCount = sortedCases.reduce((a, [, ag]) => a + ag.retryRecovered, 0);
    const finalEmptyCount = sortedCases.reduce((a, [, ag]) => a + ag.empty, 0);
    const retryRecoveryRate = initialEmptyCount ? retryRecoveredCount / initialEmptyCount : 0;
    const resourceAvgLat = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const acceptance = [
      { name: "运行轮数", value: rounds.length, threshold: thresholds.minRounds, pass: rounds.length >= thresholds.minRounds, op: ">=" },
      { name: "总通过率", value: Number(overallPassRate.toFixed(4)), threshold: thresholds.minPassRate, pass: overallPassRate >= thresholds.minPassRate, op: ">=" },
      { name: "基础设施失败率", value: Number((units ? infraUnits / units : 0).toFixed(4)), threshold: thresholds.maxInfraErrorRate, pass: (units ? infraUnits / units : 0) <= thresholds.maxInfraErrorRate, op: "<=" },
      { name: "结果翻转率", value: Number((flipDenom ? flipTotal / flipDenom : 0).toFixed(4)), threshold: thresholds.maxFlipRate, pass: (flipDenom ? flipTotal / flipDenom : 0) <= thresholds.maxFlipRate, op: "<=" },
      { name: "P95 耗时(ms)", value: pct(latencies, 95), threshold: thresholds.maxP95Ms, pass: pct(latencies, 95) <= thresholds.maxP95Ms, op: "<=" },
      { name: "单条平均成本(USD)", value: Number((units ? costSum / units : 0).toFixed(4)), threshold: thresholds.maxAvgCostUsd, pass: (units ? costSum / units : 0) <= thresholds.maxAvgCostUsd, op: "<=" }
    ];

    return {
      available: true,
      dbPath: opts.dbPath,
      subject,
      version,
      generatedAt: Date.now(),
      rounds,
      cases,
      accuracy: { units, passed: passedUnits, passRate: overallPassRate, passRateCi95: wilson(passedUnits, units), meanScore: units ? scoreSum / units : 0 },
      stability: {
        meanCasePassRate: cases.length ? casePassRateSum / cases.length : 0,
        casesWithFlip,
        flipRate: flipDenom ? flipTotal / flipDenom : 0,
        meanScoreStdev: cases.length ? stdevSum / cases.length : 0,
        emptyConclusionRate: units ? finalEmptyCount / units : 0,
        initialEmptyCount,
        retryCount: retryTotal,
        retryRecoveredCount,
        finalEmptyCount,
        retryRecoveryRate
      },
      infra: { infraUnits, infraErrorRate: units ? infraUnits / units : 0, relay, timeout, cost: costCount, parseFailure, guarded, inconclusive },
      failureTypes,
      resources: {
        avgLatencyMs: Math.round(resourceAvgLat),
        p50LatencyMs: pct(latencies, 50),
        p95LatencyMs: pct(latencies, 95),
        avgTokens: tokenUnits ? Math.round(tokensSum / tokenUnits) : 0,
        totalTokens: tokensSum,
        avgCostUsd: units ? Number((costSum / units).toFixed(6)) : 0,
        totalCostUsd: Number(costSum.toFixed(6)),
        // 估算：重试触发次数 × 单条均值，不代表真实重跑计量
        retryExtraCostUsd: units ? Number((retryTotal * (costSum / units)).toFixed(6)) : 0,
        retryExtraMs: units ? Math.round(retryTotal * resourceAvgLat) : 0
      },
      thresholds,
      acceptance
    };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

export function renderStabilityMarkdown(r: StabilityResult): string {
  const L: string[] = [];
  L.push("# 真实引擎多轮稳定性看板：" + r.subject + "@" + r.version);
  L.push("");
  L.push("生成时间：" + new Date(r.generatedAt).toISOString() + "　评测库：" + r.dbPath);
  L.push("");
  L.push("## 总览");
  L.push("");
  L.push("| 指标 | 值 |");
  L.push("| --- | --- |");
  L.push("| 轮数 | " + r.rounds.length + " |");
  L.push("| 用例×轮样本 | " + r.accuracy.units + " |");
  L.push("| 总通过率 | " + (r.accuracy.passRate * 100).toFixed(2) + "%（95%CI " + (r.accuracy.passRateCi95[0] * 100).toFixed(1) + "~" + (r.accuracy.passRateCi95[1] * 100).toFixed(1) + "%） |");
  L.push("| 平均分 | " + r.accuracy.meanScore.toFixed(4) + " |");
  L.push("| 平均每条用例通过率 | " + (r.stability.meanCasePassRate * 100).toFixed(2) + "% |");
  L.push("| 结果翻转率 | " + (r.stability.flipRate * 100).toFixed(2) + "%（" + r.stability.casesWithFlip + " 条用例发生翻转） |");
  L.push("| 平均分数标准差 | " + r.stability.meanScoreStdev.toFixed(4) + " |");
  L.push("| 空结论率 | " + (r.stability.emptyConclusionRate * 100).toFixed(2) + "% |");
  L.push("| 首次空结论率 | " + (r.accuracy.units ? (r.stability.initialEmptyCount / r.accuracy.units) * 100 : 0).toFixed(2) + "% |");
  L.push("| 重试恢复率 | " + (r.stability.retryRecoveryRate * 100).toFixed(2) + "%（重试 " + r.stability.retryCount + " 次，恢复 " + r.stability.retryRecoveredCount + " 次） |");
  L.push("| 最终空结论率 | " + (r.accuracy.units ? (r.stability.finalEmptyCount / r.accuracy.units) * 100 : 0).toFixed(2) + "% |");
  L.push("| 重试额外成本(估算) | $" + r.resources.retryExtraCostUsd.toFixed(4) + " |");
  L.push("| 重试额外耗时(估算) | " + r.resources.retryExtraMs + " ms |");
  L.push("| 基础设施失败率 | " + (r.infra.infraErrorRate * 100).toFixed(2) + "% |");
  L.push("| 平均/P50/P95 耗时 | " + r.resources.avgLatencyMs + " / " + r.resources.p50LatencyMs + " / " + r.resources.p95LatencyMs + " ms |");
  L.push("| 总成本 / 单条均值 | $" + r.resources.totalCostUsd.toFixed(4) + " / $" + r.resources.avgCostUsd.toFixed(4) + " |");
  L.push("");
  L.push("## 失败类型分布");
  L.push("");
  L.push("| 类型 | 数量 |");
  L.push("| --- | --- |");
  for (const k of Object.keys(r.failureTypes).sort()) L.push("| " + k + " | " + r.failureTypes[k] + " |");
  L.push("");
  L.push("## 验收阈值");
  L.push("");
  L.push("| 检查项 | 实际 | 阈值 | 结果 |");
  L.push("| --- | --- | --- | --- |");
  for (const a of r.acceptance) L.push("| " + a.name + " | " + a.value + " | " + a.op + " " + a.threshold + " | " + (a.pass ? "✅" : "❌") + " |");
  L.push("");
  L.push("## 逐用例（跨轮）");
  L.push("");
  L.push("| 用例 | 通过/轮次 | 通过率 | 均分 | 标准差 | 翻转 | 空结论 | 各轮状态 |");
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of r.cases) {
    L.push("| " + c.caseId + " | " + c.passedCount + "/" + c.rounds + " | " + (c.passRate * 100).toFixed(0) + "% | " + c.scoreMean.toFixed(2) + " | " + c.scoreStdev.toFixed(2) + " | " + c.flips + " | " + c.emptyCount + " | " + c.statuses.join(" / ") + " |");
  }
  L.push("");
  return L.join("\n");
}
