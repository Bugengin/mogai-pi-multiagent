export type SubtaskStatus =
  | "pending"
  | "running"
  | "stuck"
  | "done"
  | "failed"
  | "stopped";

export type Conclusion = "confirmed" | "refuted" | "inconclusive";

export interface Evidence {
  type: "code" | "log" | "test";
  locator: string;
  snippet?: string;
  verify?: string;
  supports?: string;
  valid?: boolean;
  fileExists?: boolean;
  lineMatches?: boolean | null;
  snippetFound?: boolean | null;
  verifyReason?: string;
}

export interface SubtaskResult {
  conclusion: Conclusion;
  summary: string;
  evidence: Evidence[];
  doubts: string[];
  cost: { tokens: number; usd: number };
}

export interface Subtask {
  id: string;
  title: string;
  scope: string;
  hypothesis: string;
  status: SubtaskStatus;
  progress: string[];
  result?: SubtaskResult;
  startedAt?: number;
  endedAt?: number;
  attempt?: number;
}

export interface Candidate {
  id: string;
  title: string;
  why: string;
  confidence: "high" | "medium" | "low";
}

export interface TaskVerdict {
  rootCause: string | null;
  confidence: "high" | "medium" | "low" | "inconclusive";
  reasoning: string[];
  discriminatingCheck?: string;
  unresolved: string[];
}

export type TaskMode = "diagnose" | "recon";

/** 任务终态原因：区分安全护栏、模型作答、运行失败、超时、用户停止等。 */
export type TerminalReason =
  | "guard_greeting"
  | "guard_injection"
  | "guard_encoding"
  | "no_material"
  | "model_answer"
  | "runtime_failure"
  | "timeout"
  | "user_stopped";

export interface Task {
  id: string;
  goal: string;
  mode: TaskMode;
  scope?: string;
  workspace?: string;
  evidenceRoot?: string;
  materialVersion?: string;
  workspaceFingerprint?: string;
  credentialFingerprint?: string;
  engine?: "mock" | "pi";
  provider?: string;
  modelId?: string;
  baseUrl?: string;
  status:
    | "recon"
    | "awaiting_pick"
    | "preflight"
    | "planning"
    | "running"
    | "retrying"
    | "adjudicating"
    | "done"
    | "inconclusive"
    | "timeout"
    | "failed"
    | "stopped";
  /** 本次任务实际使用的运行模式：真实 / 演示(mock) / 降级 / 历史回放。 */
  runMode?: "real" | "mock" | "degraded" | "historical";
  /** 任务最终失败的时间点（阶段），如 preflight / subtask / adjudicate。 */
  failureStage?: string;
  /** 人可读的失败原因，前端直接展示。 */
  failureReason?: string;
  /** 任务终态原因，语义比 failureReason 更稳定，供 API/数据库/前端/评测统一使用。 */
  terminalReason?: TerminalReason;
  /** 每个阶段进入时的时间戳，便于观测（可选）。 */
  phaseAt?: Record<string, number>;
  subtasks: Subtask[];
  candidates?: Candidate[];
  verdict?: TaskVerdict;
  spentUsd?: number;
  spentTokens?: number;
  createdAt: number;
}

export type ServerEvent =
  | { type: "task"; task: Task }
  | { type: "subtask"; taskId: string; subtask: Subtask }
  | { type: "log"; taskId: string; subtaskId: string; message: string }
  | { type: "verdict"; taskId: string; verdict: TaskVerdict };
