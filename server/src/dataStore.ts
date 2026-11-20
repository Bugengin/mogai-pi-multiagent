import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

export interface DocSummary {
  id: string;
  name: string;
  source: string | null;
  versions: number;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface DocVersionMeta {
  version: number;
  contentHash: string;
  note: string | null;
  createdAt: number;
  chars: number;
}

export interface ImportResult {
  documentId: string;
  version: number;
  unchanged: boolean;
}

function hashContent(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export class DataStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS documents (" +
        "id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL" +
      ");" +
      "CREATE TABLE IF NOT EXISTS doc_versions (" +
        "id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL, " +
        "content_hash TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL" +
      ");" +
      "CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON doc_versions(doc_id, version);"
    );
  }

  listDocuments(): DocSummary[] {
    const rows = this.db
      .prepare(
        "SELECT d.id, d.name, d.source, d.created_at, d.updated_at, " +
          "(SELECT COUNT(*) FROM doc_versions v WHERE v.doc_id = d.id) AS versions, " +
          "(SELECT MAX(version) FROM doc_versions v WHERE v.doc_id = d.id) AS latest " +
          "FROM documents d ORDER BY d.updated_at DESC"
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      source: r.source == null ? null : String(r.source),
      versions: Number(r.versions || 0),
      latestVersion: Number(r.latest || 0),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  getDocument(id: string): { document: DocSummary; versions: DocVersionMeta[] } | undefined {
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const vs = this.db
      .prepare("SELECT version, content_hash, note, created_at, content FROM doc_versions WHERE doc_id = ? ORDER BY version DESC")
      .all(id) as Record<string, unknown>[];
    const versions = vs.map((v) => ({
      version: Number(v.version),
      contentHash: String(v.content_hash),
      note: v.note == null ? null : String(v.note),
      createdAt: Number(v.created_at),
      chars: String(v.content || "").length
    }));
    const document: DocSummary = {
      id: String(row.id),
      name: String(row.name),
      source: row.source == null ? null : String(row.source),
      versions: versions.length,
      latestVersion: versions.length ? versions[0].version : 0,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
    return { document, versions };
  }

  getVersionContent(docId: string, version: number): { content: string; contentHash: string; note: string | null; createdAt: number } | undefined {
    const row = this.db
      .prepare("SELECT content, content_hash, note, created_at FROM doc_versions WHERE doc_id = ? AND version = ?")
      .get(docId, version) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { content: String(row.content), contentHash: String(row.content_hash), note: row.note == null ? null : String(row.note), createdAt: Number(row.created_at) };
  }

  /** 导入资料：同 name+source 已存在则作为新版本并入，内容哈希相同则不变（不重复入库）。 */
  importDocument(input: { name: string; source?: string; content: string; note?: string }): ImportResult {
    const name = input.name.trim();
    const source = input.source && input.source.trim() ? input.source.trim() : null;
    const existing = this.db
      .prepare("SELECT id FROM documents WHERE name = ? AND coalesce(source,'') = coalesce(?,'') LIMIT 1")
      .get(name, source) as Record<string, unknown> | undefined;
    if (existing) {
      const r = this.addVersion(String(existing.id), input.content, input.note);
      return { documentId: String(existing.id), version: r.version, unchanged: r.unchanged };
    }
    const documentId = "doc_" + randomUUID().slice(0, 8);
    const now = Date.now();
    this.db.prepare("INSERT INTO documents (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)").run(documentId, name, source, now, now);
    this.insertVersion(documentId, 1, input.content, input.note, now);
    return { documentId, version: 1, unchanged: false };
  }

  addVersion(docId: string, content: string, note?: string): { version: number; unchanged: boolean } {
    const doc = this.db.prepare("SELECT id FROM documents WHERE id = ?").get(docId) as Record<string, unknown> | undefined;
    if (!doc) throw new Error("文档不存在: " + docId);
    const latest = this.db
      .prepare("SELECT version, content_hash FROM doc_versions WHERE doc_id = ? ORDER BY version DESC LIMIT 1")
      .get(docId) as Record<string, unknown> | undefined;
    const h = hashContent(content);
    if (latest && String(latest.content_hash) === h) {
      return { version: Number(latest.version), unchanged: true };
    }
    const nextVersion = latest ? Number(latest.version) + 1 : 1;
    const now = Date.now();
    this.insertVersion(docId, nextVersion, content, note, now);
    this.db.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(now, docId);
    return { version: nextVersion, unchanged: false };
  }

  private insertVersion(docId: string, version: number, content: string, note: string | undefined, now: number): void {
    this.db
      .prepare("INSERT INTO doc_versions (id,doc_id,version,content,content_hash,note,created_at) VALUES (?,?,?,?,?,?,?)")
      .run("dv_" + randomUUID().slice(0, 8), docId, version, content, hashContent(content), note && note.trim() ? note.trim() : null, now);
  }

  deleteDocument(id: string): void {
    this.db.prepare("DELETE FROM doc_versions WHERE doc_id = ?").run(id);
    this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  }
}
