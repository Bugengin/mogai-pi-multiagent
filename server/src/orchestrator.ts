import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Task, Subtask, TaskVerdict, ServerEvent, SubtaskResult } from "./types";
import { planSubtasks, stepsFor, resultFor, isExportScenario, candidatesFor } from "./engine";
import { verifyEvidence } from "./verify";
import { runPiSubtask, adjudicateWithPi } from "./piEngine";
import type { EngineSettings } from "./settings";
import type { Store, TaskSummary } from "./store";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 与数据中台 manifest 同口径的目录快照指纹：相对路径 + sha256 + size 排序后哈希。 */
function treeFingerprint(root: string): string {
  try {
    const lines: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!stat.isFile()) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        const hash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        lines.push(rel + "\0" + hash + "\0" + stat.size);
      }
    };
    walk(root);
    lines.sort();
    return createHash("sha256").update(lines.join("\n") + "\n").digest("hex");
  } catch {
    return "";
  }
}
type RunToken = { taskId: string; subId: string; attempt: number; cancelled: boolean; abort?: () => void };
type Watch = { deadline: ReturnType<typeof setTimeout>; stuck: ReturnType<typeof setInterval> };

export interface CreateTaskInput {
  goal: string;
  mode?: "diagnose" | "recon";
  scope?: string;
  workspace?: string;
}

export class Orchestrator {
  private tasks = new Map<string, Task>();
  private emitters = new Map<string, EventEmitter>();
  private tokens = new Map<string, RunToken>();
  private queues = new Map<string, Subtask[]>();
  private progressAt = new Map<string, number>();
  private watches = new Map<string, Watch>();
  private taskSettings = new Map<string, EngineSettings>();

  constructor(
    private store: Store,
    private resolveWorkspace: (name?: string) => string,
    private getSettings: () => EngineSettings
  ) {}

  private tokenKey(taskId: string, subId: string, attempt: number): string {
    return taskId + ":" + subId + ":" + attempt;
  }
  private progressKey(taskId: string, subId: string, attempt: number): string {
    return taskId + ":" + subId + ":" + attempt;
  }
  private settingsFor(task: Task): EngineSettings {
    return this.taskSettings.get(task.id) || this.getSettings();
  }
  private ensureTaskSettings(task: Task): EngineSettings {
    const existing = this.taskSettings.get(task.id);
    if (existing) return existing;
    const current = this.getSettings();
    const mismatches: string[] = [];
    if (task.engine && task.engine !== current.engine) mismatches.push("引擎 " + task.engine + " -> " + current.engine);
    if (task.provider && task.provider !== current.provider) mismatches.push("供应商 " + task.provider + " -> " + current.provider);
    if (task.modelId && task.modelId !== current.modelId) mismatches.push("模型 " + task.modelId + " -> " + current.modelId);
    if ((task.baseUrl || "") !== (current.baseUrl || "")) mismatches.push("Base URL 已变化");
    const currentRoot = this.resolveWorkspace(task.workspace);
    if (task.evidenceRoot && currentRoot !== task.evidenceRoot) mismatches.push("工作区/资料快照路径已变化");
    if (task.workspaceFingerprint) {
      const currentFingerprint = treeFingerprint(currentRoot);
      if (!currentFingerprint || currentFingerprint !== task.workspaceFingerprint) {
        mismatches.push("工作区/资料快照内容已变化");
      }
    }
    if (mismatches.length > 0) {
      throw new Error("历史任务配置与当前设置不一致（" + mismatches.join("；") + "），请用当前配置新建任务，不要沿用旧任务重试");
    }
    if (current.engine === "pi" && (!current.apiKey || !current.modelId)) {
      throw new Error("当前真实 Pi 配置不完整（缺少 API Key 或模型），无法重试历史任务");
    }
    this.taskSettings.set(task.id, { ...current });
    return this.taskSettings.get(task.id)!;
  }
  private currentToken(task: Task, sub: Subtask): RunToken | undefined {
    return this.tokens.get(this.tokenKey(task.id, sub.id, sub.attempt || 1));
  }
  private isCurrentAttempt(task: Task, sub: Subtask, token: RunToken): boolean {
    return sub.status === "running"
      && (sub.attempt || 1) === token.attempt
      && this.tokens.get(this.tokenKey(task.id, sub.id, token.attempt)) === token;
  }

  private fire(taskId: string, ev: ServerEvent): void {
    const em = this.emitters.get(taskId);
    if (em) em.emit("event", ev);
  }
  private emitTask(task: Task): void {
    this.store.saveTask(task);
    this.fire(task.id, { type: "task", task });
  }
  private emitSub(task: Task, sub: Subtask): void {
    this.store.saveTask(task);
    this.fire(task.id, { type: "subtask", taskId: task.id, subtask: sub });
  }

  subscribe(taskId: string, fn: (ev: ServerEvent) => void): () => void {
    const em = this.emitters.get(taskId);
    if (!em) return () => undefined;
    const h = (ev: ServerEvent): void => fn(ev);
    em.on("event", h);
    return () => em.off("event", h);
  }

  listTasks(limit?: number): TaskSummary[] {
    return this.store.list(limit || 50);
  }

  deleteTask(id: string): void {
    this.stopWatch(id);
    this.queues.delete(id);
    this.taskSettings.delete(id);
    for (const key of Array.from(this.tokens.keys())) {
      if (key.startsWith(id + ":")) this.tokens.delete(key);
    }
    for (const key of Array.from(this.progressAt.keys())) {
      if (key.startsWith(id + ":")) this.progressAt.delete(key);
    }
    this.tasks.delete(id);
    this.emitters.delete(id);
    this.store.delete(id);
  }

  getTask(id: string): Task | undefined {
    const cached = this.tasks.get(id);
    if (cached) return cached;
    const loaded = this.store.loadTask(id);
    if (!loaded) return undefined;
    if (loaded.status === "planning" || loaded.status === "running" || loaded.status === "recon" || loaded.status === "adjudicating") {
      loaded.status = "stopped";
      for (const sub of loaded.subtasks) {
        if (sub.status === "running") {
          sub.status = "stopped";
          sub.endedAt = Date.now();
        }
      }
    }
    this.tasks.set(id, loaded);
    this.emitters.set(id, new EventEmitter());
    return loaded;
  }

  createTask(input: CreateTaskInput): Task {
    const id = "task_" + randomUUID().slice(0, 8);
    const goal = (input.goal || "").trim() || "帮我看看这个范围里有没有问题";
    const mode = input.mode || "diagnose";
    const settings = this.getSettings();
    this.taskSettings.set(id, { ...settings });
    const evidenceRoot = this.resolveWorkspace(input.workspace);
    const materialMatch = /@(mver_[A-Za-z0-9]+)/.exec(evidenceRoot);
    const task: Task = {
      id,
      goal,
      mode,
      scope: input.scope && input.scope.trim() ? input.scope.trim() : undefined,
      status: mode === "recon" ? "recon" : "running",
      workspace: input.workspace,
      evidenceRoot,
      materialVersion: materialMatch ? materialMatch[1] : undefined,
      workspaceFingerprint: treeFingerprint(evidenceRoot),
      engine: settings.engine,
      provider: settings.provider,
      modelId: settings.modelId,
      baseUrl: settings.baseUrl,
      subtasks: [],
      spentUsd: 0,
      spentTokens: 0,
      createdAt: Date.now()
    };
    this.tasks.set(id, task);
    this.emitters.set(id, new EventEmitter());
    this.emitTask(task);

    if (mode === "recon") {
      void this.runRecon(task);
    } else {
      this.buildSubtasks(task);
      this.emitTask(task);
      this.startWatch(task);
      this.enqueueAll(task);
    }
    return task;
  }

  async runToCompletion(input: CreateTaskInput): Promise<Task> {
    const task = this.createTask(input);
    return await new Promise<Task>((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        if (task.status === "done" || task.status === "failed" || task.status === "stopped" || Date.now() - started > 180000) {
          clearInterval(iv);
          resolve(task);
        }
      }, 150);
    });
  }

  private buildSubtasks(task: Task): void {
    const planned = planSubtasks(task.goal);
    task.subtasks = planned.map((p) => ({
      id: p.id,
      title: p.title,
      scope: p.scope,
      hypothesis: p.hypothesis,
      status: "pending" as const,
      progress: [],
      attempt: 0
    }));
  }

  private async runRecon(task: Task): Promise<void> {
    await sleep(1400);
    if (this.tasks.get(task.id) !== task || task.status !== "recon") return;
    task.candidates = candidatesFor(task.goal, task.scope);
    task.status = "awaiting_pick";
    this.emitTask(task);
  }

  pickCandidate(taskId: string, candidateId: string): string | null {
    const task = this.tasks.get(taskId) || this.getTask(taskId);
    if (!task || !task.candidates) return "找不到任务或候选";
    if (task.status === "stopped") return "任务已停止，请新建任务";
    try {
      this.ensureTaskSettings(task);
    } catch (e) {
      return String((e as Error).message || e);
    }
    const cand = task.candidates.find((c) => c.id === candidateId);
    if (!cand) return "找不到候选";
    task.goal = cand.title;
    task.mode = "diagnose";
    task.candidates = undefined;
    task.verdict = undefined;
    task.spentUsd = 0;
    task.spentTokens = 0;
    task.status = "running";
    this.buildSubtasks(task);
    this.emitTask(task);
    this.startWatch(task);
    this.enqueueAll(task);
    return null;
  }

  private enqueueAll(task: Task): void {
    this.queues.set(task.id, task.subtasks.filter((s) => s.status === "pending"));
    this.pump(task);
  }

  private pump(task: Task): void {
    if (task.status !== "running") return;
    const q = this.queues.get(task.id) || [];
    const max = Math.max(1, this.settingsFor(task).maxConcurrency || 4);
    let running = task.subtasks.filter((s) => s.status === "running").length;
    while (running < max && q.length > 0) {
      const sub = q.shift()!;
      if (sub.status !== "pending") continue;
      this.startSubtask(task, sub);
      running++;
    }
  }

  private startWatch(task: Task): void {
    this.stopWatch(task.id);
    const settings = this.settingsFor(task);
    const maxSec = Math.max(2, settings.maxTaskSeconds || 300);
    const stuckSec = Math.max(5, settings.stuckSeconds || 90);
    const deadline = setTimeout(() => {
      this.failTask(task, "超过任务时限（" + maxSec + "s），已中止");
    }, maxSec * 1000);
    const stuck = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const sub of task.subtasks) {
        if (sub.status !== "running") continue;
        const last = this.progressAt.get(this.progressKey(task.id, sub.id, sub.attempt || 1)) || sub.startedAt || now;
        if (now - last > stuckSec * 1000) {
          sub.status = "stuck";
          sub.endedAt = now;
          const tok = this.currentToken(task, sub);
          if (tok) {
            tok.cancelled = true;
            if (tok.abort) { try { tok.abort(); } catch { /* ignore */ } }
          }
          this.emitSub(task, sub);
          changed = true;
        }
      }
      if (changed) {
        this.pump(task);
        this.maybeAdjudicate(task);
      }
    }, 5000);
    this.watches.set(task.id, { deadline, stuck });
  }

  private stopWatch(taskId: string): void {
    const w = this.watches.get(taskId);
    if (w) {
      clearTimeout(w.deadline);
      clearInterval(w.stuck);
      this.watches.delete(taskId);
    }
  }

  private failTask(task: Task, reason: string): void {
    this.stopWatch(task.id);
    this.queues.set(task.id, []);
    for (const sub of task.subtasks) {
      if (sub.status === "running" || sub.status === "pending") {
        sub.status = "stopped";
        sub.endedAt = Date.now();
        const tok = this.currentToken(task, sub);
        if (tok) {
          tok.cancelled = true;
          if (tok.abort) { try { tok.abort(); } catch { /* ignore */ } }
        }
        this.emitSub(task, sub);
      }
    }
    task.status = "failed";
    task.verdict = {
      rootCause: null,
      confidence: "inconclusive",
      reasoning: [reason, "已中止所有子任务，保留已完成部分"],
      unresolved: ["可调大限额后重试，或缩小排查范围"]
    };
    this.fire(task.id, { type: "verdict", taskId: task.id, verdict: task.verdict });
    this.emitTask(task);
  }

  private startSubtask(task: Task, sub: Subtask): void {
    if (sub.status === "running") return;
    sub.attempt = (sub.attempt || 0) + 1;
    sub.status = "running";
    sub.progress = [];
    sub.result = undefined;
    sub.startedAt = Date.now();
    sub.endedAt = undefined;
    const token: RunToken = { taskId: task.id, subId: sub.id, attempt: sub.attempt, cancelled: false };
    this.tokens.set(this.tokenKey(task.id, sub.id, token.attempt), token);
    this.progressAt.set(this.progressKey(task.id, sub.id, token.attempt), Date.now());
    this.emitSub(task, sub);
    void this.runLoop(task, sub, token);
  }

  private pushProgress(task: Task, sub: Subtask, msg: string, token?: RunToken): void {
    if (token && !this.isCurrentAttempt(task, sub, token)) return;
    sub.progress.push(msg);
    this.progressAt.set(this.progressKey(task.id, sub.id, sub.attempt || 1), Date.now());
    this.fire(task.id, { type: "log", taskId: task.id, subtaskId: sub.id, message: msg });
    this.emitSub(task, sub);
  }

  private verifyResult(res: SubtaskResult, root: string): void {
    const results = res.evidence.map((e) => verifyEvidence(e, root));
    res.evidence = res.evidence.map((e, i) => ({
      ...e,
      valid: results[i].valid,
      fileExists: results[i].fileExists,
      lineMatches: results[i].lineMatches,
      snippetFound: results[i].snippetFound,
      verifyReason: results[i].reason,
    }));
    const invalid = results.filter((r) => !r.valid);
    if (invalid.length > 0) {
      res.doubts.push("证据校验未通过：" + invalid.map((r) => r.reason).join("；"));
    }
    if (res.evidence.length === 0) {
      res.conclusion = "inconclusive";
      res.summary = "（缺少可核验证据，结论降级为不确定）" + res.summary;
      res.doubts.push("未提供可核验证据");
      return;
    }
    const validCount = results.filter((r) => r.valid).length;
    if (validCount === 0) {
      res.conclusion = "inconclusive";
      res.summary = "（证据校验未通过，结论降级为不确定）" + res.summary;
    }
  }

  private finishSubtask(task: Task, sub: Subtask, res: SubtaskResult, token?: RunToken): void {
    if (token && !this.isCurrentAttempt(task, sub, token)) return;
    this.verifyResult(res, this.resolveWorkspace(task.workspace));
    sub.result = res;
    sub.status = "done";
    sub.endedAt = Date.now();
    task.spentUsd = (task.spentUsd || 0) + (res.cost ? res.cost.usd : 0);
    task.spentTokens = (task.spentTokens || 0) + (res.cost ? res.cost.tokens : 0);
    this.emitSub(task, sub);

    const cap = this.settingsFor(task).maxCostUsd;
    if (cap > 0 && (task.spentUsd || 0) > cap) {
      this.failTask(task, "超过费用上限（$" + cap + "），已中止");
      return;
    }
    this.pump(task);
    this.maybeAdjudicate(task);
  }

  private failSubtask(task: Task, sub: Subtask, token: RunToken, reason: string, partial?: SubtaskResult): void {
    if (!this.isCurrentAttempt(task, sub, token)) return;
    const res: SubtaskResult = partial
      ? { ...partial, doubts: [...(partial.doubts || [])] }
      : { conclusion: "inconclusive", summary: "运行失败：" + reason, evidence: [], doubts: [], cost: { tokens: 0, usd: 0 } };
    if (!res.doubts.includes(reason)) res.doubts.push(reason);
    sub.result = res;
    sub.status = "failed";
    sub.endedAt = Date.now();
    this.emitSub(task, sub);
    this.pump(task);
    this.maybeAdjudicate(task);
  }

  private async runLoop(task: Task, sub: Subtask, token: RunToken): Promise<void> {
    const settings = this.settingsFor(task);
    // mock 只在用户明确选择演示模式时执行；engine=pi 的任何失败都不许回退 mock。
    if (settings.engine !== "pi") {
      await this.runMock(task, sub, token);
      return;
    }
    if (!settings.apiKey || !settings.modelId) {
      this.failSubtask(task, sub, token, "真实 Pi 引擎缺少 API Key 或模型设置，未执行");
      return;
    }
    try {
      const res = await runPiSubtask(
        settings,
        task,
        sub,
        this.resolveWorkspace(task.workspace),
        (msg) => this.pushProgress(task, sub, msg, token),
        (fn) => { token.abort = fn; }
      );
      if (!this.isCurrentAttempt(task, sub, token)) return;
      this.finishSubtask(task, sub, res, token);
    } catch (e) {
      if (!this.isCurrentAttempt(task, sub, token)) return;
      this.failSubtask(task, sub, token, "真实 Pi 调用失败：" + String(e).slice(0, 240));
    }
  }

  private async runMock(task: Task, sub: Subtask, token: RunToken, note?: string): Promise<void> {
    const steps = stepsFor(task.goal, sub);
    for (const step of steps) {
      await sleep(step.delay);
      if (!this.isCurrentAttempt(task, sub, token)) return;
      this.pushProgress(task, sub, step.text, token);
    }
    if (!this.isCurrentAttempt(task, sub, token)) return;
    const res = resultFor(task.goal, sub);
    if (note) res.doubts.push(note);
    this.finishSubtask(task, sub, res, token);
  }

  stopSubtask(taskId: string, subtaskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const sub = task.subtasks.find((s) => s.id === subtaskId);
    if (!sub) return;
    const token = this.currentToken(task, sub);
    if (token) {
      token.cancelled = true;
      if (token.abort) { try { token.abort(); } catch { /* ignore */ } }
    }
    if (sub.status === "running") {
      sub.status = "stopped";
      sub.endedAt = Date.now();
      this.emitSub(task, sub);
      this.pump(task);
      this.maybeAdjudicate(task);
    }
  }

  stopTask(taskId: string): void {
    const task = this.tasks.get(taskId) || this.getTask(taskId);
    if (!task) return;
    this.stopWatch(task.id);
    this.queues.set(task.id, []);
    for (const sub of task.subtasks) {
      if (sub.status === "running" || sub.status === "pending") {
        const token = this.currentToken(task, sub);
        if (token) {
          token.cancelled = true;
          if (token.abort) { try { token.abort(); } catch { /* ignore */ } }
        }
        sub.status = "stopped";
        sub.endedAt = Date.now();
        this.emitSub(task, sub);
      }
    }
    task.status = "stopped";
    this.emitTask(task);
  }

  retrySubtask(taskId: string, subtaskId: string): string | null {
    const task = this.tasks.get(taskId) || this.getTask(taskId);
    if (!task) return "找不到任务";
    const sub = task.subtasks.find((s) => s.id === subtaskId);
    if (!sub) return "找不到子任务";
    if (sub.status === "running") return null;
    try {
      this.ensureTaskSettings(task);
    } catch (e) {
      return String((e as Error).message || e);
    }
    if (task.status !== "running") {
      task.verdict = undefined;
      task.status = "running";
      this.startWatch(task);
      this.emitTask(task);
    }
    this.startSubtask(task, sub);
    return null;
  }

  private maybeAdjudicate(task: Task): void {
    if (task.status !== "running") return;
    const terminal = task.subtasks.every(
      (s) => s.status === "done" || s.status === "failed" || s.status === "stopped" || s.status === "stuck"
    );
    if (terminal) void this.adjudicate(task);
  }

  private async adjudicate(task: Task): Promise<void> {
    task.status = "adjudicating";
    this.emitTask(task);
    const settings = this.settingsFor(task);
    const realRequested = settings.engine === "pi";
    const usePi = realRequested && !!settings.apiKey && !!settings.modelId;
    let verdict: TaskVerdict | null = null;
    if (usePi) {
      try {
        verdict = await adjudicateWithPi(settings, task, this.resolveWorkspace(task.workspace));
      } catch {
        verdict = null;
      }
    }
    // 任务可能已被停止/超时/删除；迟到仲裁结果必须丢弃，不能把状态改回完成。
    if (this.tasks.get(task.id) !== task || task.status !== "adjudicating") return;
    if (!verdict) {
      if (realRequested) {
        verdict = this.makeInconclusiveVerdict(
          task,
          usePi ? "主 Pi 真实仲裁失败，未采用模板结论" : "真实 Pi 引擎缺少 API Key 或模型，未进行真实仲裁"
        );
      } else {
        await sleep(600);
        if (this.tasks.get(task.id) !== task || task.status !== "adjudicating") return;
        verdict = this.makeVerdict(task, true);
      }
    }
    const anyDone = task.subtasks.some((s) => s.status === "done" && s.result);
    task.verdict = verdict;
    task.status = anyDone ? "done" : "failed";
    this.stopWatch(task.id);
    this.fire(task.id, { type: "verdict", taskId: task.id, verdict });
    this.emitTask(task);
  }

  private makeInconclusiveVerdict(task: Task, reason: string): TaskVerdict {
    const doubts = task.subtasks.flatMap((s) => (s.result ? s.result.doubts : []));
    return {
      rootCause: null,
      confidence: "inconclusive",
      reasoning: [reason, "已完成的子任务与证据保留，不做模板推断"],
      unresolved: Array.from(new Set([...doubts, reason])),
    };
  }

  private makeVerdict(task: Task, allowTemplate = false): TaskVerdict {
    const done = task.subtasks.filter((s) => s.status === "done" && s.result);
    if (allowTemplate && isExportScenario(task.goal)) {
      return {
        rootCause: "查询过滤条件 status='PENDING' 使查询返回 0 行；写入逻辑只是如实写出空表头，不是写入 bug。",
        confidence: "high",
        reasoning: [
          "子任务A(查询)：结论=成立，证据=queryBuilder.ts:18 + 日志 rows=0（已校验）",
          "子任务B(写入)：结论=排除，证据=writer.ts:8 空结果只写表头（已校验）",
          "两者冲突：A 指查询过滤，B 指写入层；但 B 缺少写入前行数日志，证据等级低于 A",
          "判别性检查：同一导出 ID 下，在 writer.ts:8 前后各打一次 rows 计数日志并复跑",
          "检查结果：写入前 rows 已为 0 -> 排除写入层，确认查询过滤为根因"
        ],
        discriminatingCheck: "在 writer.ts:8 前后各打 rows 计数日志（同一导出 ID 复跑）",
        unresolved: ["PENDING 状态是否本应有历史数据，需产品确认", "下游压缩步骤未纳入本次排查"]
      };
    }
    const conclusions = done.map((s) => s.result!.conclusion);
    if (conclusions.length === 0) {
      return this.makeInconclusiveVerdict(task, "没有子任务产出可核验结论，不硬给根因");
    }
    const allConfirmed = conclusions.every((c) => c === "confirmed");
    const hasInconclusive = conclusions.some((c) => c === "inconclusive");
    if (allConfirmed) {
      return {
        rootCause: done[0].result!.summary,
        confidence: "medium",
        reasoning: ["各子任务结论一致且均成立", "证据已通过文件/日志/测试校验"],
        unresolved: done.flatMap((s) => s.result!.doubts)
      };
    }
    if (hasInconclusive) {
      return {
        rootCause: null,
        confidence: "inconclusive",
        reasoning: ["存在证据不足或被校验驳回的子任务", "当前证据无法区分各假说，不硬给结论"],
        unresolved: done.flatMap((s) => s.result!.doubts)
      };
    }
    return {
      rootCause: done[0]?.result?.summary ?? null,
      confidence: "low",
      reasoning: ["子任务结论存在分歧或未完成", "建议补一次判别性检查后再下结论"],
      unresolved: done.flatMap((s) => s.result!.doubts)
    };
  }
}