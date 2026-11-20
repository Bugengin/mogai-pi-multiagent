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
  valid?: boolean;
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

export interface Task {
  id: string;
  goal: string;
  mode: TaskMode;
  scope?: string;
  workspace?: string;
  status:
    | "recon"
    | "awaiting_pick"
    | "planning"
    | "running"
    | "adjudicating"
    | "done"
    | "failed"
    | "stopped";
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