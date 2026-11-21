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

test("retrying a stopped task restarts the full workflow", async () => {
  const orch = makeOrchestrator();
  const task = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  orch.stopTask(task.id);
  assert.equal(task.status, "stopped");
  const error = orch.retrySubtask(task.id, "s1");
  assert.equal(error, null);
  await sleep(4500);
  assert.equal(task.status, "done");
  assert.ok(task.verdict);
  assert.equal(task.subtasks.find((s) => s.id === "s1")!.status, "done");
});

test("stopped recon task stays stopped", async () => {
  const orch = makeOrchestrator();
  const task = orch.createTask({ mode: "recon", goal: "帮我看看这个项目" });
  orch.stopTask(task.id);
  await sleep(1800);
  assert.equal(task.status, "stopped");
  assert.equal(task.candidates, undefined);
});

test("retry old task is rejected when workspace snapshot changed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ws-"));
  const wsA = path.join(dir, "a");
  const wsB = path.join(dir, "b");
  fs.mkdirSync(wsA); fs.mkdirSync(wsB);
  fs.writeFileSync(path.join(wsA, "f.txt"), "a", "utf8");
  fs.writeFileSync(path.join(wsB, "f.txt"), "b", "utf8");
  const db = path.join(dir, "pi.db");
  const settings: any = { engine: "mock", provider: "openai", modelId: "gpt-4.1", apiKey: "", maxTaskSeconds: 30, maxCostUsd: 1.5, maxConcurrency: 2, stuckSeconds: 20 };
  const orch = new Orchestrator(new Store(db), () => wsA, () => settings);
  const task = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  const orch2 = new Orchestrator(new Store(db), () => wsB, () => settings);
  const error = orch2.retrySubtask(task.id, "s1");
  assert.ok(String(error || "").includes("工作区/资料快照路径已变化"));
});

test("retry old task is rejected when base URL changed from default", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-url-"));
  const db = path.join(dir, "pi.db");
  const base: any = { engine: "mock", provider: "openai", modelId: "gpt-4.1", apiKey: "", maxTaskSeconds: 30, maxCostUsd: 1.5, maxConcurrency: 2, stuckSeconds: 20 };
  const orch = new Orchestrator(new Store(db), () => path.resolve(process.cwd(), "..", "demo-workspace"), () => base);
  const task = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  const changed: any = { ...base, baseUrl: "http://custom.example/v1" };
  const orch2 = new Orchestrator(new Store(db), () => path.resolve(process.cwd(), "..", "demo-workspace"), () => changed);
  const error = orch2.retrySubtask(task.id, "s1");
  assert.match(String(error || ""), /Base URL 已变化/);
});

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

test("retry in same process is rejected after workspace path changes (cached settings must not skip verification)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ws-cache-"));
  const wsA = path.join(dir, "a");
  const wsB = path.join(dir, "b");
  fs.mkdirSync(wsA); fs.mkdirSync(wsB);
  fs.writeFileSync(path.join(wsA, "f.txt"), "a", "utf8");
  fs.writeFileSync(path.join(wsB, "f.txt"), "b", "utf8");
  const db = path.join(dir, "pi.db");
  const settings: any = { engine: "mock", provider: "openai", modelId: "gpt-4.1", apiKey: "", maxTaskSeconds: 30, maxCostUsd: 1.5, maxConcurrency: 2, stuckSeconds: 20 };
  let ws = wsA;
  const orch = new Orchestrator(new Store(db), () => ws, () => settings);
  const task = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  await sleep(50);
  orch.stopTask(task.id);
  ws = wsB;
  const error = orch.retrySubtask(task.id, "s1");
  assert.ok(String(error || "").includes("工作区/资料快照路径已变化"), "same-process retry must be rejected after workspace path changes");
});

test("retry in same process is rejected after workspace content changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ws-cache-content-"));
  const ws = path.join(dir, "ws");
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, "f.txt"), "v1", "utf8");
  const db = path.join(dir, "pi.db");
  const settings: any = { engine: "mock", provider: "openai", modelId: "gpt-4.1", apiKey: "", maxTaskSeconds: 30, maxCostUsd: 1.5, maxConcurrency: 2, stuckSeconds: 20 };
  const orch = new Orchestrator(new Store(db), () => ws, () => settings);
  const task = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  await sleep(50);
  orch.stopTask(task.id);
  fs.writeFileSync(path.join(ws, "f.txt"), "v2", "utf8");
  const error = orch.retrySubtask(task.id, "s1");
  assert.ok(String(error || "").includes("工作区/资料快照内容已变化"), "same-process retry must be rejected after workspace content changes");
});

test("retry across process is rejected when API key changed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-key-"));
  const db = path.join(dir, "pi.db");
  const ws = path.resolve(process.cwd(), "..", "demo-workspace");
  const base: any = { engine: "mock", provider: "openai", modelId: "gpt-4.1", apiKey: "key-a", maxTaskSeconds: 30, maxCostUsd: 1.5, maxConcurrency: 2, stuckSeconds: 20 };
  const orch = new Orchestrator(new Store(db), () => ws, () => base);
  const task = orch.createTask({ goal: "导出文件为空，帮我查一下原因" });
  const changed: any = { ...base, apiKey: "key-b" };
  const orch2 = new Orchestrator(new Store(db), () => ws, () => changed);
  const error = orch2.retrySubtask(task.id, "s1");
  assert.match(String(error || ""), /API Key|凭据/);
});
