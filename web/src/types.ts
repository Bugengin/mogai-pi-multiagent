export type SubtaskStatus = "pending" | "running" | "stuck" | "done" | "failed" | "stopped";
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

export interface Task {
  id: string;
  goal: string;
  mode: TaskMode;
  scope?: string;
  workspace?: string;
  evidenceRoot?: string;
  materialVersion?: string;
  workspaceFingerprint?: string;
  engine?: "mock" | "pi";
  provider?: string;
  modelId?: string;
  baseUrl?: string;
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

export interface TaskSummary {
  id: string;
  goal: string;
  mode: string;
  status: string;
  createdAt: number;
  confidence?: string;
  engine?: string;
  modelId?: string;
  workspace?: string;
  materialVersion?: string;
  workspaceFingerprint?: string;
}

export type ServerEvent =
  | { type: "task"; task: Task }
  | { type: "subtask"; taskId: string; subtask: Subtask }
  | { type: "log"; taskId: string; subtaskId: string; message: string }
  | { type: "verdict"; taskId: string; verdict: TaskVerdict };