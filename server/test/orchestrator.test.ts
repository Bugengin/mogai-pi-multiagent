import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../src/orchestrator";
import { Store } from "../src/store";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeOrchestrator(): Orchestrator {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orch-"));
  const store = new Store(path.join(dir, "pi.db"));
  const settings = {
    engine: "mock" as const,
    provider: "openai",
    modelId: "gpt-4.1",
    apiKey: "",
    maxTaskSeconds: 60,
    maxCostUsd: 1.5,
    maxConcurrency: 4,
    stuckSeconds: 90
  };
  return new Orchestrator(store, () => path.resolve(process.cwd(), "..", "demo-workspace"), () => settings);
}

test("retry old task is rejected when engine config changed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-retry-"));
  const db = path.join(dir, "pi.db");
  const settingsPi: any = {
    engine: "pi", provider: "openai", modelId: "gpt-4.1", apiKey: "",
    maxTaskSeconds: 30, maxCostUsd: 1.5, maxConcurrency: 2, stuckSeconds: 20
  };
  const orch = new Orchestrator(new Store(db), () => path.resolve(process.cwd(), "..", "demo-workspace"), () => settingsPi);
  const task = await orch.runToCompletion({ goal: "导出文件为空，帮我查一下原因" });
  assert.equal(task.status, "failed");
  const settingsMock: any = { ...settingsPi, engine: "mock" };
  const orch2 = new Orchestrator(new Store(db), () => path.resolve(process.cwd(), "..", "demo-workspace"), () => settingsMock);
  const error = orch2.retrySubtask(task.id, "s1");
  assert.match(String(error || ""), /配置与当前设置不一致/);
});

test("stopSubtask isolates tasks with identical subtask ids", async () => {
  const orch = makeOrchestrator();
  const a = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  const b = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  await sleep(100);
  orch.stopSubtask(a.id, "s1");
  await sleep(4500);
  const a1 = a.subtasks.find((s) => s.id === "s1")!;
  const b1 = b.subtasks.find((s) => s.id === "s1")!;
  assert.equal(a1.status, "stopped", "target task subtask should stop");
  assert.equal(b1.status, "done", "other task subtask should finish normally");
  assert.equal(b1.progress.length, 4, "other task should keep its progress");
});
