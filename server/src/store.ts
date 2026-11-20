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
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS tasks (" +
        "id TEXT PRIMARY KEY, goal TEXT NOT NULL, mode TEXT NOT NULL, scope TEXT, status TEXT NOT NULL, " +
        "candidates_json TEXT, verdict_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL" +
      ");" +
      "CREATE TABLE IF NOT EXISTS subtasks (" +
        "task_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, scope TEXT NOT NULL, hypothesis TEXT NOT NULL, " +
        "status TEXT NOT NULL, progress_json TEXT NOT NULL, result_json TEXT, started_at INTEGER, ended_at INTEGER, " +
        "PRIMARY KEY (task_id, id)" +
      ");"
    );
  }

  saveTask(task: Task): void {
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO tasks (id,goal,mode,scope,status,candidates_json,verdict_json,created_at,updated_at) " +
          "VALUES (?,?,?,?,?,?,?,?,?) " +
          "ON CONFLICT(id) DO UPDATE SET goal=excluded.goal, mode=excluded.mode, scope=excluded.scope, " +
          "status=excluded.status, candidates_json=excluded.candidates_json, verdict_json=excluded.verdict_json, updated_at=excluded.updated_at"
      )
      .run(
        task.id,
        task.goal,
        task.mode,
        task.scope ?? null,
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
      .prepare("SELECT id,goal,mode,status,created_at,verdict_json FROM tasks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      goal: String(r.goal),
      mode: String(r.mode),
      status: String(r.status),
      createdAt: Number(r.created_at),
      confidence: r.verdict_json ? String((JSON.parse(String(r.verdict_json)) as { confidence?: string }).confidence) : undefined
    }));
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM subtasks WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }
}
