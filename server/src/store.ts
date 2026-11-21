import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { Task } from "./types";

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

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS tasks (" +
        "id TEXT PRIMARY KEY, goal TEXT NOT NULL, mode TEXT NOT NULL, scope TEXT, workspace TEXT, evidence_root TEXT, material_version TEXT, workspace_fingerprint TEXT, engine TEXT, provider TEXT, model_id TEXT, base_url TEXT, credential_fingerprint TEXT, " +
        "status TEXT NOT NULL, candidates_json TEXT, verdict_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL" +
      ");" +
      "CREATE TABLE IF NOT EXISTS subtasks (" +
        "task_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, scope TEXT NOT NULL, hypothesis TEXT NOT NULL, " +
        "status TEXT NOT NULL, progress_json TEXT NOT NULL, result_json TEXT, started_at INTEGER, ended_at INTEGER, " +
        "PRIMARY KEY (task_id, id)" +
      ");"
    );
    this.ensureTaskColumns();
  }

  private ensureTaskColumns(): void {
    const cols = new Set(
      (this.db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name)
    );
    for (const [name, type] of [["workspace", "TEXT"], ["evidence_root", "TEXT"], ["material_version", "TEXT"], ["workspace_fingerprint", "TEXT"], ["engine", "TEXT"], ["provider", "TEXT"], ["model_id", "TEXT"], ["base_url", "TEXT"], ["credential_fingerprint", "TEXT"]] as const) {
      if (!cols.has(name)) this.db.exec("ALTER TABLE tasks ADD COLUMN " + name + " " + type);
    }
  }

  saveTask(task: Task): void {
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO tasks (id,goal,mode,scope,workspace,evidence_root,material_version,workspace_fingerprint,engine,provider,model_id,base_url,credential_fingerprint,status,candidates_json,verdict_json,created_at,updated_at) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
          "ON CONFLICT(id) DO UPDATE SET goal=excluded.goal, mode=excluded.mode, scope=excluded.scope, " +
          "workspace=excluded.workspace, evidence_root=excluded.evidence_root, material_version=excluded.material_version, workspace_fingerprint=excluded.workspace_fingerprint, " +
          "engine=excluded.engine, provider=excluded.provider, model_id=excluded.model_id, base_url=excluded.base_url, credential_fingerprint=excluded.credential_fingerprint, " +
          "status=excluded.status, candidates_json=excluded.candidates_json, verdict_json=excluded.verdict_json, updated_at=excluded.updated_at"
      )
      .run(
        task.id,
        task.goal,
        task.mode,
        task.scope ?? null,
        task.workspace ?? null,
        task.evidenceRoot ?? null,
        task.materialVersion ?? null,
        task.workspaceFingerprint ?? null,
        task.engine ?? null,
        task.provider ?? null,
        task.modelId ?? null,
        task.baseUrl ?? null,
        task.credentialFingerprint ?? null,
        task.status,
        task.candidates ? JSON.stringify(task.candidates) : null,
        task.verdict ? JSON.stringify(task.verdict) : null,
        task.createdAt,
        now
      );

    this.db.prepare("DELETE FROM subtasks WHERE task_id = ?").run(task.id);
    const ins = this.db.prepare(
      "INSERT INTO subtasks (task_id,id,title,scope,hypothesis,status,progress_json,result_json,started_at,ended_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    for (const s of task.subtasks) {
      ins.run(
        task.id,
        s.id,
        s.title,
        s.scope,
        s.hypothesis,
        s.status,
        JSON.stringify(s.progress),
        s.result ? JSON.stringify(s.result) : null,
        s.startedAt ?? null,
        s.endedAt ?? null
      );
    }
  }

  loadTask(id: string): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const subs = this.db.prepare("SELECT * FROM subtasks WHERE task_id = ? ORDER BY id").all(id) as Record<string, unknown>[];
    const task: Task = {
      id: String(row.id),
      goal: String(row.goal),
      mode: row.mode as Task["mode"],
      scope: row.scope == null ? undefined : String(row.scope),
      workspace: row.workspace == null ? undefined : String(row.workspace),
      evidenceRoot: row.evidence_root == null ? undefined : String(row.evidence_root),
      materialVersion: row.material_version == null ? undefined : String(row.material_version),
      workspaceFingerprint: row.workspace_fingerprint == null ? undefined : String(row.workspace_fingerprint),
      credentialFingerprint: row.credential_fingerprint == null ? undefined : String(row.credential_fingerprint),
      engine: row.engine === "pi" || row.engine === "mock" ? row.engine : undefined,
      provider: row.provider == null ? undefined : String(row.provider),
      modelId: row.model_id == null ? undefined : String(row.model_id),
      baseUrl: row.base_url == null ? undefined : String(row.base_url),
      status: row.status as Task["status"],
      subtasks: subs.map((s) => ({
        id: String(s.id),
        title: String(s.title),
        scope: String(s.scope),
        hypothesis: String(s.hypothesis),
        status: s.status as Task["subtasks"][number]["status"],
        progress: JSON.parse(String(s.progress_json)) as string[],
        result: s.result_json ? (JSON.parse(String(s.result_json)) as Task["subtasks"][number]["result"]) : undefined,
        startedAt: s.started_at == null ? undefined : Number(s.started_at),
        endedAt: s.ended_at == null ? undefined : Number(s.ended_at)
      })),
      candidates: row.candidates_json ? (JSON.parse(String(row.candidates_json)) as Task["candidates"]) : undefined,
      verdict: row.verdict_json ? (JSON.parse(String(row.verdict_json)) as Task["verdict"]) : undefined,
      createdAt: Number(row.created_at)
    };
    return task;
  }

  list(limit = 50): TaskSummary[] {
    const rows = this.db
      .prepare("SELECT id,goal,mode,status,created_at,verdict_json,engine,model_id,workspace,material_version FROM tasks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      goal: String(r.goal),
      mode: String(r.mode),
      status: String(r.status),
      createdAt: Number(r.created_at),
      confidence: r.verdict_json ? String((JSON.parse(String(r.verdict_json)) as { confidence?: string }).confidence) : undefined,
      engine: r.engine == null ? undefined : String(r.engine),
      modelId: r.model_id == null ? undefined : String(r.model_id),
      workspace: r.workspace == null ? undefined : String(r.workspace),
      materialVersion: r.material_version == null ? undefined : String(r.material_version),
      workspaceFingerprint: r.workspace_fingerprint == null ? undefined : String(r.workspace_fingerprint)
    }));
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM subtasks WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }
}
