import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EvalService, computeSummary, failureCategoryOf, toEvalplatReport } from "../src/evalService";

test("stats: computeSummary reports sample size, stdev and CI", () => {
  const rs: any[] = [
    { score: 1, passed: true, usd: 0.1, ms: 100, tags: ["x"] },
    { score: 0.4, passed: false, usd: 0.2, ms: 200, tags: ["x"] },
    { score: 0.8, passed: true, usd: 0.0, ms: 300, tags: ["y"] }
  ];
  const s = computeSummary(rs);
  assert.equal(s.total, 3);
  assert.equal(s.sampleSize, 3);
  assert.equal(s.passed, 2);
  assert.ok(Math.abs(s.passRate - 2 / 3) < 1e-9);
  assert.ok(s.scoreStdev > 0, "stdev should be > 0");
  assert.ok(s.passRateCi95[0] <= s.passRate && s.passRate <= s.passRateCi95[1]);
  assert.equal(s.byTag!["x"].total, 2);
  assert.equal(s.byTag!["x"].passed, 1);
  assert.equal(s.byTag!["y"].passed, 1);
  assert.deepEqual(s.outcomes, { passed: 2, failed: 1, inconclusive: 0, timeout: 0, guarded: 0 });
});

test("eval: repeats and metadata are recorded; agent/keyword score separated", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-eval-"));
  const cases = [{ id: "ct1", dataset: "t", goal: "导出为空", expect: ["查询", "0 行"], rubric: "查询过滤", workspace: "export" }];
  fs.writeFileSync(path.join(dir, "eval_cases.json"), JSON.stringify(cases), "utf8");
  const svc = new EvalService(dir);
  const fake: any = {
    runToCompletion: async () => ({
      verdict: { rootCause: "查询过滤导致 0 行", confidence: "high" },
      spentUsd: 0.02,
      spentTokens: 120,
      materialVersion: "mver_x",
      workspaceFingerprint: "fp"
    })
  };
  const run = await svc.run("t", fake, undefined, { repeats: 2, meta: { engine: "mock", provider: "openai", modelId: "gpt-x", temperature: 0 } });
  assert.equal(run.repeats, 2);
  assert.equal(run.meta!.repeats, 2);
  assert.equal(run.meta!.temperature, 0);
  assert.equal(run.meta!.modelId, "gpt-x");
  assert.equal(run.summary.sampleSize, 1);
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].repeats, 2);
  assert.equal(run.results[0].agentScore, 1);
  assert.equal(run.results[0].agentPassed, true);
  assert.ok(Math.abs(run.results[0].usd - 0.04) < 1e-9);
});

test("eval: 首次空结论并重试恢复记录 initialEmpty/retryCount/recoveredByRetry", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-eval-retry-"));
  fs.writeFileSync(path.join(dir, "eval_cases.json"), JSON.stringify([
    { id: "ct1", dataset: "t", goal: "导出为空", expect: ["查询", "0 行"], workspace: "export" }
  ]), "utf8");
  const svc = new EvalService(dir);
  let n = 0;
  const fake: any = {
    runToCompletion: async () => {
      n++;
      if (n === 1) {
        // 第一次空结论
        return { verdict: { rootCause: null, confidence: "inconclusive" }, status: "inconclusive", spentUsd: 0.01, spentTokens: 5, terminalReason: "no_material" };
      }
      // 重跑恢复出结论
      return { verdict: { rootCause: "查询过滤导致 0 行", confidence: "high" }, status: "done", spentUsd: 0.02, spentTokens: 10, terminalReason: "model_answer" };
    }
  };
  const run = await svc.run("t", fake, undefined, { repeats: 1 });
  const r = run.results[0];
  assert.equal(r.initialEmpty, true);
  assert.equal(r.retryCount, 1);
  assert.equal(r.recoveredByRetry, true);
  assert.equal(r.retryRecovered, true);
  assert.equal(r.initialRootCause, null);
  assert.equal(r.initialStatus, "inconclusive");
  assert.equal(r.finalRootCause, "查询过滤导致 0 行");

  // 报告 meta 携带重试指标
  const report: any = toEvalplatReport(run, "pi-multiagent");
  const meta = report.results[0].subject.meta;
  assert.equal(meta.initialEmpty, true);
  assert.equal(meta.retryCount, 1);
  assert.equal(meta.retryRecovered, true);
  assert.equal(meta.recoveredByRetry, true);
  assert.equal(meta.initialStatus, "inconclusive");
  assert.equal(meta.initialRootCause, null);
  assert.equal(meta.finalRootCause, "查询过滤导致 0 行");
});

test("eval: failureCategory 把基础设施失败与 agent 失败分开", () => {
  assert.equal(failureCategoryOf("preflight"), "relay");
  assert.equal(failureCategoryOf("timeout"), "timeout");
  assert.equal(failureCategoryOf("deadline"), "timeout");
  assert.equal(failureCategoryOf("cost"), "cost");
  assert.equal(failureCategoryOf("adjudicate"), "judge");
  assert.equal(failureCategoryOf("subtask"), "agent");
  assert.equal(failureCategoryOf("runtime"), "agent");
  assert.equal(failureCategoryOf(undefined, "guard_injection"), "guard");
  assert.equal(failureCategoryOf(undefined, "no_material"), "inconclusive");
  assert.equal(failureCategoryOf(undefined, undefined), undefined);
});

test("eval: repeatResults 逐次保留，并按 average/all/majority 聚合", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-eval-rep-"));
  fs.writeFileSync(path.join(dir, "eval_cases.json"), JSON.stringify([
    { id: "ct1", dataset: "t", goal: "导出为空", expect: ["查询", "0 行"], workspace: "export" }
  ]), "utf8");
  const svc = new EvalService(dir);
  let n = 0;
  const fake: any = {
    runToCompletion: async () => {
      n++;
      const ok = n % 2 === 0; // 4 次里第 2、4 次通过 => 2/4
      return {
        verdict: ok ? { rootCause: "查询过滤导致 0 行", confidence: "high" } : { rootCause: "无关结论", confidence: "low" },
        spentUsd: 0.01, spentTokens: 10, status: "done", terminalReason: "model_answer"
      };
    }
  };
  const majority = await svc.run("t", fake, undefined, { repeats: 4, aggregation: "majority" });
  const r = majority.results[0];
  assert.equal(r.repeatResults!.length, 4);
  assert.deepEqual(r.repeatResults!.map((x) => x.passed), [false, true, false, true]);
  assert.equal(r.passCount, 2);
  assert.equal(r.score, 0.5);
  assert.equal(r.passed, false, "majority 2/4 不应通过");
  assert.equal(r.aggregation, "majority");
  assert.equal(majority.meta!.aggregation, "majority");
  assert.equal(r.actualSource, "best");
  assert.equal(r.repeatResults![1].actual, "查询过滤导致 0 行");

  n = 0;
  const avg = await svc.run("t", fake, undefined, { repeats: 4, aggregation: "average" });
  assert.equal(avg.results[0].passed, true, "average 0.5 应通过");
  n = 0;
  const all = await svc.run("t", fake, undefined, { repeats: 4, aggregation: "all" });
  assert.equal(all.results[0].passed, false, "all 有失败应不通过");
});
