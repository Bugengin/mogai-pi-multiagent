import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { verifyEvidence } from "../src/verify";
import { scoreCase } from "../src/evalService";

const root = path.resolve(process.cwd(), "..", "demo-workspace");

test("verify: valid code evidence passes", () => {
  const r = verifyEvidence({ type: "code", locator: "queryBuilder.ts:120", snippet: 'where("status", "PENDING")' }, root);
  assert.equal(r.valid, true);
});

test("verify: missing file fails", () => {
  const r = verifyEvidence({ type: "code", locator: "nope.ts:3" }, root);
  assert.equal(r.valid, false);
});

test("verify: line out of range fails", () => {
  const r = verifyEvidence({ type: "log", locator: "logs/export-2026-11-19.log:9999" }, root);
  assert.equal(r.valid, false);
});

test("verify: test locator checks file+case", () => {
  const ok = verifyEvidence({ type: "test", locator: "writer.spec.ts#empty" }, root);
  assert.equal(ok.valid, true);
  const bad = verifyEvidence({ type: "test", locator: "writer.spec.ts#not-exist-case" }, root);
  assert.equal(bad.valid, false);
});

test("scoreCase: all keywords matched -> pass", () => {
  const r = scoreCase(["查询", "0 行"], "查询过滤导致 0 行");
  assert.equal(r.passed, true);
  assert.equal(r.score, 1);
});

test("scoreCase: partial below 0.6 -> fail", () => {
  const r = scoreCase(["报表", "时区", "口径"], "报表数据问题");
  assert.equal(r.passed, false);
  assert.ok(r.score < 0.6);
});

test("scoreCase: null actual -> fail", () => {
  const r = scoreCase(["a"], null);
  assert.equal(r.passed, false);
  assert.equal(r.score, 0);
});
