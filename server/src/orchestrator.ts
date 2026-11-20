import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Task, Subtask, TaskVerdict, ServerEvent, SubtaskResult } from "./types";
import { planSubtasks, stepsFor, resultFor, isExportScenario, candidatesFor } from "./engine";
import { verifyEvidence } from "./verify";
import { runPiSubtask, adjudicateWithPi } from "./piEngine";
import type { EngineSettings } from "./settings";
import type { Store, TaskSummary } from "./store";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type RunToken = { cancelled: boolean; abort?: () => void };
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

  constructor(
    private store: Store,
    private resolveWorkspace: (name?: string) => string,
    private getSettings: () => EngineSettings
  ) {}

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
    }
    this.tasks.set(id, loaded);
    this.emitters.set(id, new EventEmitter());
    return loaded;
  }

  createTask(input: CreateTaskInput): Task {
    const id = "task_" + randomUUID().slice(0, 8);
    const goal = (input.goal || "").trim() || "帮我看看这个范围里有没有问题";
    const mode = input.mode || "diagnose";
    const task: Task = {
      id,
      goal,
      mode,
      scope: input.scope && input.scope.trim() ? input.scope.trim() : undefined,
      status: mode === "recon" ? "recon" : "running",
      workspace: input.workspace,
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
      progress: []
    }));
  }

  private async runRecon(task: Task): Promise<void> {
    await sleep(1400);
    task.candidates = candidatesFor(task.goal, task.scope);
    task.status = "awaiting_pick";
    this.emitTask(task);
  }

  pickCandidate(taskId: string, candidateId: string): void {
    const task = this.tasks.get(taskId) || this.getTask(taskId);
    if (!task || !task.candidates) return;
    const cand = task.candidates.find((c) => c.id === candidateId);
    if (!cand) return;
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
  }

  private enqueueAll(task: Task): void {
    this.queues.set(task.id, task.subtasks.filter((s) => s.status === "pending"));
    this.pump(task);
  }

  private pump(task: Task): void {
    const q = this.queues.get(task.id) || [];
    const max = Math.max(1, this.getSettings().maxConcurrency || 4);
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
    const settings = this.getSettings();
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
        const last = this.progressAt.get(sub.id) || sub.startedAt || now;
        if (now - last > stuckSec * 1000) {
          sub.status = "stuck";
          sub.endedAt = now;
          const tok = this.tokens.get(sub.id);
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
        const tok = this.tokens.get(sub.id);
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
    sub.status = "running";
    sub.progress = [];
    sub.result = undefined;
    sub.startedAt = Date.now();
    sub.endedAt = undefined;
    const token: RunToken = { cancelled: false };
    this.tokens.set(sub.id, token);
    this.progressAt.set(sub.id, Date.now());
    this.emitSub(task, sub);
    void this.runLoop(task, sub, token);
  }

  private pushProgress(task: Task, sub: Subtask, msg: string): void {
    sub.progress.push(msg);
    this.progressAt.set(sub.id, Date.now());
    this.fire(task.id, { type: "log", taskId: task.id, subtaskId: sub.id, message: msg });
    this.emitSub(task, sub);
  }

  private verifyResult(res: SubtaskResult, root: string): void {
    const results = res.evidence.map((e) => verifyEvidence(e, root));
    res.evidence = res.evidence.map((e, i) => ({ ...e, valid: results[i].valid }));
    const invalid = results.filter((r) => !r.valid);
    if (invalid.length > 0) {
      res.doubts.push("证据校验未通过：" + invalid.map((r) => r.reason).join("；"));
    }
    const validCount = results.filter((r) => r.valid).length;
    if (res.evidence.length > 0 && validCount === 0) {
      res.conclusion = "inconclusive";
      res.summary = "（证据校验未通过，结论降级为不确定）" + res.summary;
    }
  }

  private finishSubtask(task: Task, sub: Subtask, res: SubtaskResult): void {
    this.verifyResult(res, this.resolveWorkspace(task.workspace));
    sub.result = res;
    sub.status = "done";
    sub.endedAt = Date.now();
    task.spentUsd = (task.spentUsd || 0) + (res.cost ? res.cost.usd : 0);
    task.spentTokens = (task.spentTokens || 0) + (res.cost ? res.cost.tokens : 0);
    this.emitSub(task, sub);

    const cap = this.getSettings().maxCostUsd;
    if (cap > 0 && (task.spentUsd || 0) > cap) {
      this.failTask(task, "超过费用上限（$" + cap + "），已中止");
      return;
    }
    this.pump(task);
    this.maybeAdjudicate(task);
  }

  private async runLoop(task: Task, sub: Subtask, token: RunToken): Promise<void> {
    const settings = this.getSettings();
    const usePi = settings.engine === "pi" && !!settings.apiKey && !!settings.modelId;
    if (usePi) {
      try {
        const res = await runPiSubtask(
          settings,
          task,
          sub,
          this.resolveWorkspace(task.workspace),
          (msg) => this.pushProgress(task, sub, msg),
          (fn) => { token.abort = fn; }
        );
        if (token.cancelled) return;
        this.finishSubtask(task, sub, res);
        return;
      } catch (e) {
        await this.runMock(task, sub, token, "真实 pi 调用失败，已回退 mock：" + String(e).slice(0, 160));
        return;
      }
    }
    await this.runMock(task, sub, token);
  }

  private async runMock(task: Task, sub: Subtask, token: RunToken, note?: string): Promise<void> {
    const steps = stepsFor(task.goal, sub);
    for (const step of steps) {
      await sleep(step.delay);
      if (token.cancelled) return;
      this.pushProgress(task, sub, step.text);
    }
    if (token.cancelled) return;
    const res = resultFor(task.goal, sub);
    if (note) res.doubts.push(note);
    this.finishSubtask(task, sub, res);
  }

  stopSubtask(taskId: string, subtaskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const sub = task.subtasks.find((s) => s.id === subtaskId);
    if (!sub) return;
    const token = this.tokens.get(sub.id);
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

  retrySubtask(taskId: string, subtaskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const sub = task.subtasks.find((s) => s.id === subtaskId);
    if (!sub) return;
    if (sub.status === "running") return;
    if (task.verdict) {
      task.verdict = undefined;
      task.status = "running";
      this.startWatch(task);
      this.emitTask(task);
    }
    this.startSubtask(task, sub);
  }

  private maybeAdjudicate(task: Task): void {
    if (task.status !== "running") return;
    const terminal = task.subtasks.every(
      (s) => s.status === "done" || s.status === "failed" || s.status === "stopped" || s.status === "stuck"
    );
    const anyDone = task.subtasks.some((s) => s.status === "done");
    if (terminal && anyDone) void this.adjudicate(task);
  }

  private async adjudicate(task: Task): Promise<void> {
    task.status = "adjudicating";
    this.emitTask(task);
    const settings = this.getSettings();
    const usePi = settings.engine === "pi" && !!settings.apiKey && !!settings.modelId;
    let verdict: TaskVerdict | null = null;
    if (usePi) {
      try {
        verdict = await adjudicateWithPi(settings, task, this.resolveWorkspace(task.workspace));
      } catch {
        verdict = null;
      }
    }
    if (!verdict) {
      await sleep(600);
      verdict = this.makeVerdict(task);
      if (usePi) verdict.unresolved = [...verdict.unresolved, "主 Pi 真实仲裁失败，已回退模板结论"];
    }
    task.verdict = verdict;
    task.status = "done";
    this.stopWatch(task.id);
    this.fire(task.id, { type: "verdict", taskId: task.id, verdict });
    this.emitTask(task);
  }

  private makeVerdict(task: Task): TaskVerdict {
    const done = task.subtasks.filter((s) => s.status === "done" && s.result);
    if (isExportScenario(task.goal)) {
      return {
        rootCause: "查询过滤条件 status='PENDING' 使查询返回 0 行；写入逻辑只是如实写出空表头，不是写入 bug。",
        confidence: "high",
        reasoning: [
          "子任务A(查询)：结论=成立，证据=queryBuilder.ts:120 + 日志 rows=0（已校验）",
          "子任务B(写入)：结论=排除，证据=writer.ts:42 空结果只写表头（已校验）",
          "两者冲突：A 指查询过滤，B 指写入层；但 B 缺少写入前行数日志，证据等级低于 A",
          "判别性检查：同一导出 ID 下，在 writer.ts:42 前后各打一次 rows 计数日志并复跑",
          "检查结果：写入前 rows 已为 0 -> 排除写入层，确认查询过滤为根因"
        ],
        discriminatingCheck: "在 writer.ts:42 前后各打 rows 计数日志（同一导出 ID 复跑）",
        unresolved: ["PENDING 状态是否本应有历史数据，需产品确认", "下游压缩步骤未纳入本次排查"]
      };
    }
    const conclusions = done.map((s) => s.result!.conclusion);
    const allConfirmed = conclusions.length > 0 && conclusions.every((c) => c === "confirmed");
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