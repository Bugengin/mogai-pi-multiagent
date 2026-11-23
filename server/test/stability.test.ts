import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { computeStability } from "../src/stability";

function detail(caseId: string, status: string, score: number, opts: any = {}): string {
  return JSON.stringify({
    case_id: caseId,
    status,
    score,
    scores: [],
    subject: {
      output: { verdict: { rootCause: opts.rootCause === undefined ? "根因" : opts.rootCause, confidence: opts.confidence || "high" }, runMode: "real" },
      error: opts.error || null,
      latency_ms: opts.latency || 1000,
      cost_usd: opts.cost || 0.01,
      tokens_in: 0,
      tokens_out: opts.tokens || 100,
      meta: {
        status: opts.taskStatus || "done",
        failureStage: opts.failureStage || null,
        failureCategory: opts.failureCategory || null,
        terminalReason: opts.terminalReason || null,
        failureReason: opts.failureReason || null,
        initialEmpty: opts.initialEmpty,
        retryCount: opts.retryCount,
        recoveredByRetry: opts.recoveredByRetry
      }
    },
    tags: [],
    error: opts.error || null
  });
}

function buildDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stab-"));
  const dbPath = path.join(dir, "evalplat.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE runs (id TEXT PRIMARY KEY,name TEXT,subject TEXT,subject_version TEXT,dataset TEXT,dataset_hash TEXT,operators TEXT,started_at TEXT,finished_at TEXT,metrics TEXT,meta TEXT);" +
      "CREATE TABLE case_results (run_id TEXT,case_id TEXT,status TEXT,score REAL,latency_ms REAL,detail TEXT,PRIMARY KEY(run_id,case_id));"
  );
  const insRun = db.prepare("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const insRes = db.prepare("INSERT INTO case_results VALUES (?,?,?,?,?,?)");
  for (let i = 1; i <= 3; i++) {
    insRun.run("r" + i, "round" + i, "pi-multiagent", "0.1.2-real", "dsv", "h", "[]", "t" + i, "t" + i, "{}", "{}");
  }
  // c1: pass / fail / pass -> flip 2
  insRes.run("r1", "c1", "passed", 1, 1000, detail("c1", "passed", 1));
  insRes.run("r2", "c1", "failed", 0.5, 1200, detail("c1", "failed", 0.5));
  insRes.run("r3", "c1", "passed", 1, 900, detail("c1", "passed", 1));
  // c2: always pass
  insRes.run("r1", "c2", "passed", 1, 1000, detail("c2", "passed", 1));
  insRes.run("r2", "c2", "passed", 1, 1100, detail("c2", "passed", 1));
  insRes.run("r3", "c2", "passed", 1, 1050, detail("c2", "passed", 1));
  // c3: infra relay on r1; guarded on r2; inconclusive on r3
  insRes.run("r1", "c3", "error", 0, 500, detail("c3", "error", 0, { failureStage: "preflight", failureCategory: "relay", error: "relay down", rootCause: null }));
  insRes.run("r2", "c3", "passed", 1, 600, detail("c3", "passed", 1, { terminalReason: "guard_injection" }));
  insRes.run("r3", "c3", "failed", 0, 700, detail("c3", "failed", 0, { taskStatus: "inconclusive", confidence: "inconclusive", rootCause: null }));
  db.close();
  return dbPath;
}

test("stability: multi-round metrics, flips, infra split", () => {
  const dbPath = buildDb();
  const r = computeStability({ dbPath, subject: "pi-multiagent", version: "0.1.2-real" });
  assert.equal(r.available, true);
  assert.equal(r.rounds.length, 3);
  assert.equal(r.accuracy.units, 9);
  assert.equal(r.accuracy.passed, 6);
  assert.ok(Math.abs(r.accuracy.passRate - 6 / 9) < 1e-9);
  const c1 = r.cases.find((c) => c.caseId === "c1")!;
  assert.equal(c1.passedCount, 2);
  assert.equal(c1.rounds, 3);
  assert.equal(c1.flips, 2);
  assert.ok(c1.scoreStdev > 0);
  assert.equal(r.infra.relay, 1);
  assert.equal(r.infra.guarded, 1);
  assert.equal(r.infra.inconclusive, 1);
  assert.ok(Math.abs(r.infra.infraErrorRate - 1 / 9) < 1e-9);
  assert.equal(r.failureTypes["agent_bug"], 1);
  const infraCheck = r.acceptance.find((a) => a.name === "基础设施失败率")!;
  assert.equal(infraCheck.pass, false);
  const roundsCheck = r.acceptance.find((a) => a.name === "运行轮数")!;
  assert.equal(roundsCheck.pass, true);
  assert.ok(r.resources.p95LatencyMs >= r.resources.p50LatencyMs);
});

function buildRetryDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stab-retry-"));
  const dbPath = path.join(dir, "evalplat.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE runs (id TEXT PRIMARY KEY,name TEXT,subject TEXT,subject_version TEXT,dataset TEXT,dataset_hash TEXT,operators TEXT,started_at TEXT,finished_at TEXT,metrics TEXT,meta TEXT);" +
      "CREATE TABLE case_results (run_id TEXT,case_id TEXT,status TEXT,score REAL,latency_ms REAL,detail TEXT,PRIMARY KEY(run_id,case_id));"
  );
  const insRun = db.prepare("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const insRes = db.prepare("INSERT INTO case_results VALUES (?,?,?,?,?,?)");
  for (let i = 1; i <= 2; i++) {
    insRun.run("r" + i, "round" + i, "pi-multiagent", "0.1.2-real", "dsv", "h", "[]", "t" + i, "t" + i, "{}", "{}");
  }
  // cost 失败 -> cost_failure，计入 infra（不再并入 relay）
  insRes.run("r1", "c_cost", "error", 0, 500, detail("c_cost", "error", 0, { failureCategory: "cost", error: "cost exceeded", rootCause: null }));
  insRes.run("r2", "c_cost", "passed", 1, 1000, detail("c_cost", "passed", 1));
  // parse 失败 -> parse_failure，计入 infra
  insRes.run("r1", "c_parse", "error", 0, 500, detail("c_parse", "error", 0, { failureReason: "parse error", rootCause: null }));
  insRes.run("r2", "c_parse", "passed", 1, 1000, detail("c_parse", "passed", 1));
  // c_retry：r1 首次空结论但重试恢复；r2 首次空结论且未恢复
  insRes.run("r1", "c_retry", "passed", 1, 1000, detail("c_retry", "passed", 1, { initialEmpty: true, retryCount: 1, recoveredByRetry: true }));
  insRes.run("r2", "c_retry", "failed", 0, 800, detail("c_retry", "failed", 0, { initialEmpty: true, retryCount: 1, recoveredByRetry: false, rootCause: null }));
  db.close();
  return dbPath;
}

test("stability: cost/parse 计入 infra，空结论重试指标来自 meta", () => {
  const dbPath = buildRetryDb();
  const r = computeStability({ dbPath, subject: "pi-multiagent", version: "0.1.2-real" });
  assert.equal(r.available, true);
  assert.equal(r.accuracy.units, 6);
  // cost -> cost_failure，且不并入 relay
  assert.equal(r.infra.cost, 1);
  assert.equal(r.infra.relay, 0);
  // parse -> parse_failure
  assert.equal(r.infra.parseFailure, 1);
  assert.equal(r.failureTypes["cost_failure"], 1);
  assert.equal(r.failureTypes["parse_failure"], 1);
  // infraUnits = relay + timeout + cost + parseFailure = 0+0+1+1
  assert.equal(r.infra.infraUnits, 2);
  assert.ok(Math.abs(r.infra.infraErrorRate - 2 / 6) < 1e-9);
  // 空结论重试指标（旧数据缺字段为 0，这里由合成 meta 提供）
  assert.equal(r.stability.initialEmptyCount, 2);
  assert.equal(r.stability.retryCount, 2);
  assert.equal(r.stability.retryRecoveredCount, 1);
  assert.equal(r.stability.finalEmptyCount, 3); // c_cost r1 + c_parse r1 + c_retry r2
  assert.ok(Math.abs(r.stability.retryRecoveryRate - 0.5) < 1e-9);
  const cRetry = r.cases.find((c) => c.caseId === "c_retry")!;
  assert.equal(cRetry.retryCount, 2);
  assert.equal(cRetry.retryRecovered, 1);
  // 额外成本/耗时按 retryCount×单位均值估算
  assert.ok(r.resources.retryExtraCostUsd > 0);
  assert.ok(Math.abs(r.resources.retryExtraCostUsd - 2 * r.resources.avgCostUsd) < 1e-9);
  assert.ok(r.resources.retryExtraMs > 0);
  assert.ok(Math.abs(r.resources.retryExtraMs - Math.round(2 * r.resources.avgLatencyMs)) <= 2);
  // 旧数据缺字段降级为 0（c_cost / c_parse 的 retryCount 均为 0）
  const cCost = r.cases.find((c) => c.caseId === "c_cost")!;
  assert.equal(cCost.retryCount, 0);
  assert.equal(cCost.retryRecovered, 0);
});

test("stability: missing db degrades clearly", () => {
  const r = computeStability({ dbPath: path.join(os.tmpdir(), "nope-" + Date.now(), "evalplat.db"), subject: "pi-multiagent", version: "0.1.2-real" });
  assert.equal(r.available, false);
  assert.ok(r.reason);
});

test("stability: no matching runs reports reason", () => {
  const dbPath = buildDb();
  const r = computeStability({ dbPath, subject: "pi-multiagent", version: "9.9.9" });
  assert.equal(r.available, false);
  assert.match(String(r.reason), /没有符合条件/);
});
