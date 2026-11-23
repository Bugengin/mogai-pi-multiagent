import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 数据权威来源（第 5 步）：
 * 数据中台的 `dataplat.db` 是发布的唯一权威事实来源；pi 自带评测/数据页只是本地演示缓存。
 * 这里只读打开权威库，供 pi 页面展示「正式发布 / 运行导入 / 未关闭失败」，避免两套结果互相矛盾。
 */
export interface AuthorityRun {
  runImportId: string;
  evalRunId: string;
  subjectVersion: string;
  matchStatus: string;
  total: number;
  passed: number;
  passRate: number;
  meanScore: number;
  importedAt: string;
}
export interface AuthorityRelease {
  releaseNo: string;
  id: string;
  datasetVersionId: string;
  caseCount: number;
  fingerprint: string;
  agentVersion: string;
  publishedAt: string;
  runs: AuthorityRun[];
}
export interface AuthorityFailure {
  id: string;
  releaseNo: string;
  caseId: string;
  category: string;
  verdict: string;
  rootCause: string;
}
export interface EvalDbInfo {
  path: string;
  available: boolean;
  runCount: number;
  hasR003: boolean;
}
export interface AuthoritySummary {
  available: boolean;
  authoritative: boolean;
  source: string;
  reason?: string;
  generatedAt: number;
  releases: AuthorityRelease[];
  openFailures: AuthorityFailure[];
  pendingImports: number;
  /** 评测执行库（evalplat.db）信息：与数据权威库区分展示，避免误以为是同一个库 */
  evalDb: EvalDbInfo;
  totals: { releases: number; runImports: number; openFailures: number };
}

export function findDataplatDb(): string | undefined {
  const env = process.env.PI_DATAPLAT_DB;
  if (env && env.trim()) return path.resolve(env.trim());
  // pi/server/src -> ../../../数据中台/db/dataplat.db
  const guess = path.resolve(moduleDir, "../../../数据中台/db/dataplat.db");
  return fs.existsSync(guess) ? guess : undefined;
}

export function findEvalplatDb(): string {
  const env = process.env.PI_EVALPLAT_DB;
  if (env && env.trim()) return path.resolve(env.trim());
  // pi/server/src -> ../../../评测中台/eval-platform/evalplat.db
  return path.resolve(moduleDir, "../../../评测中台/eval-platform/evalplat.db");
}

function readEvalDbInfo(evalPath: string): EvalDbInfo {
  const info: EvalDbInfo = { path: evalPath, available: false, runCount: 0, hasR003: false };
  if (!evalPath || !fs.existsSync(evalPath)) return info;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(evalPath, { readOnly: true });
  } catch {
    try {
      db = new DatabaseSync(evalPath);
    } catch {
      return info;
    }
  }
  try {
    const cnt = safeOne(db, "SELECT COUNT(*) AS n FROM runs");
    info.runCount = Number((cnt && cnt.n) || 0);
    info.hasR003 = !!safeOne(db, "SELECT id FROM runs WHERE id = 'run_ac42dfc81340'");
    info.available = true;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  return info;
}

function safeAll(db: DatabaseSync, sql: string, params: any[] = []): Record<string, unknown>[] {
  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[];
  } catch {
    return [];
  }
}
function safeOne(db: DatabaseSync, sql: string, params: any[] = []): Record<string, unknown> | undefined {
  try {
    return db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}

function withDataplatDb<T>(
  dbPath: string | undefined,
  fallback: (reason: string, source: string) => T,
  fn: (db: DatabaseSync, source: string) => T
): T {
  const source = dbPath || findDataplatDb() || "";
  if (!source || !fs.existsSync(source)) {
    return fallback("未找到数据中台库（可用环境变量 PI_DATAPLAT_DB 指定）", source);
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(source, { readOnly: true });
  } catch {
    try {
      db = new DatabaseSync(source);
    } catch (e) {
      return fallback("无法打开数据中台库：" + String(e).slice(0, 120), source);
    }
  }
  try {
    return fn(db, source);
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export interface AuthMaterialVersion {
  id: string;
  versionNo: number;
  status: string;
  contentSha256: string;
  contentPath: string;
  effectiveDate: string;
  ingestedAt: string;
  notes: string;
}
export interface AuthMaterial {
  id: string;
  title: string;
  sourceType: string;
  sourceRef: string;
  originalFilename: string;
  mime: string;
  sizeBytes: number;
  sha256Original: string;
  createdAt: string;
  versions: AuthMaterialVersion[];
}
export interface AuthorityMaterialsResult {
  available: boolean;
  authoritative: boolean;
  source: string;
  reason?: string;
  materials: AuthMaterial[];
}
export interface AuthorityMaterialDetailResult extends AuthorityMaterialsResult {
  material?: AuthMaterial & {
    sections: { id: string; versionId: string; seq: number; heading: string; pageFrom: number | null; pageTo: number | null; textSha256: string }[];
    linkedCases: { caseId: string; caseVersionId: string; caseTitle: string; locator: string; quote: string }[];
  };
}

function mapMaterial(row: Record<string, unknown>, versions: AuthMaterialVersion[]): AuthMaterial {
  return {
    id: String(row.material_id || ""),
    title: String(row.title || ""),
    sourceType: String(row.source_type || ""),
    sourceRef: String(row.source_ref || ""),
    originalFilename: String(row.original_filename || ""),
    mime: String(row.mime || ""),
    sizeBytes: Number(row.size_bytes || 0),
    sha256Original: String(row.sha256_original || ""),
    createdAt: String(row.created_at || ""),
    versions
  };
}

function materialVersionRows(db: DatabaseSync): Record<string, unknown>[] {
  return safeAll(
    db,
    "SELECT id, material_id, version_no, status, content_path, content_sha256, effective_date, ingested_at, notes FROM material_version ORDER BY version_no DESC"
  );
}

function groupMaterialVersions(rows: Record<string, unknown>[]): Map<string, AuthMaterialVersion[]> {
  const map = new Map<string, AuthMaterialVersion[]>();
  for (const v of rows) {
    const mid = String(v.material_id);
    if (!map.has(mid)) map.set(mid, []);
    map.get(mid)!.push({
      id: String(v.id),
      versionNo: Number(v.version_no || 0),
      status: String(v.status || ""),
      contentSha256: String(v.content_sha256 || ""),
      contentPath: String(v.content_path || ""),
      effectiveDate: String(v.effective_date || ""),
      ingestedAt: String(v.ingested_at || ""),
      notes: String(v.notes || "")
    });
  }
  return map;
}

export function readAuthorityMaterials(dbPath?: string): AuthorityMaterialsResult {
  return withDataplatDb<AuthorityMaterialsResult>(
    dbPath,
    (reason, source) => ({ available: false, authoritative: true, source, reason, materials: [] }),
    (db, source) => {
      const rows = safeAll(
        db,
        "SELECT id AS material_id, title, source_type, source_ref, original_filename, mime, size_bytes, sha256_original, created_at FROM material ORDER BY created_at"
      );
      const versions = groupMaterialVersions(materialVersionRows(db));
      const materials = rows.map((r) => mapMaterial(r, versions.get(String(r.material_id)) || []));
      return { available: true, authoritative: true, source, materials };
    }
  );
}

export function readAuthorityMaterial(id: string, dbPath?: string): AuthorityMaterialDetailResult {
  return withDataplatDb<AuthorityMaterialDetailResult>(
    dbPath,
    (reason, source) => ({ available: false, authoritative: true, source, reason, materials: [] }),
    (db, source) => {
      const row = safeOne(
        db,
        "SELECT id AS material_id, title, source_type, source_ref, original_filename, mime, size_bytes, sha256_original, created_at FROM material WHERE id = ?",
        [id] as never
      );
      if (!row) return { available: true, authoritative: true, source, reason: "未找到该资料", materials: [] };
      const versions = (groupMaterialVersions(materialVersionRows(db)).get(id) || []);
      const base = mapMaterial(row, versions);
      const versionIds = versions.map((v) => v.id);
      const sections: { id: string; versionId: string; seq: number; heading: string; pageFrom: number | null; pageTo: number | null; textSha256: string }[] = [];
      if (versionIds.length > 0) {
        const placeholders = versionIds.map(() => "?").join(",");
        const secs = db
          .prepare(
            "SELECT id, material_version_id, seq, heading, page_from, page_to, text_sha256 FROM material_section WHERE material_version_id IN (" +
              placeholders +
              ") ORDER BY material_version_id, seq"
          )
          .all(...versionIds) as Record<string, unknown>[];
        for (const s of secs) {
          sections.push({
            id: String(s.id),
            versionId: String(s.material_version_id),
            seq: Number(s.seq || 0),
            heading: String(s.heading || ""),
            pageFrom: s.page_from == null ? null : Number(s.page_from),
            pageTo: s.page_to == null ? null : Number(s.page_to),
            textSha256: String(s.text_sha256 || "")
          });
        }
      }
      const linkedRows = safeAll(
        db,
        "SELECT ce.case_version_id, ce.locator, ce.quote, cv.case_id, COALESCE(ec.title, '') AS case_title " +
          "FROM case_evidence ce LEFT JOIN case_version cv ON cv.id = ce.case_version_id " +
          "LEFT JOIN eval_case ec ON ec.id = cv.case_id WHERE ce.material_version_id IN (" +
          versionIds.map(() => "?").join(",") +
          ") ORDER BY cv.case_id",
        versionIds as never
      );
      const linkedCases = linkedRows.map((r) => ({
        caseId: String(r.case_id || ""),
        caseVersionId: String(r.case_version_id || ""),
        caseTitle: String(r.case_title || ""),
        locator: String(r.locator || ""),
        quote: String(r.quote || "")
      }));
      return { available: true, authoritative: true, source, materials: [base], material: { ...base, sections, linkedCases } };
    }
  );
}

export interface AuthCaseVersion {
  id: string;
  versionNo: number;
  status: string;
  input: unknown;
  expected: unknown;
  tags: string[];
  basisSummary: string;
  contentSha256: string;
  createdAt: string;
  publishedAt: string;
}
export interface AuthCase {
  id: string;
  title: string;
  sceneTag: string;
  currentVersionId: string;
  createdAt: string;
  versions: AuthCaseVersion[];
}
export interface AuthorityCasesResult {
  available: boolean;
  authoritative: boolean;
  source: string;
  reason?: string;
  cases: AuthCase[];
}

function parseJson(v: unknown): unknown {
  try {
    return JSON.parse(String(v == null ? "" : v));
  } catch {
    return null;
  }
}

export function readAuthorityCases(dbPath?: string): AuthorityCasesResult {
  return withDataplatDb<AuthorityCasesResult>(
    dbPath,
    (reason, source) => ({ available: false, authoritative: true, source, reason, cases: [] }),
    (db, source) => {
      const caseRows = safeAll(
        db,
        "SELECT id, title, scene_tag, current_version_id, created_at FROM eval_case ORDER BY created_at"
      );
      const verRows = safeAll(
        db,
        "SELECT id, case_id, version_no, status, input_json, expected_json, tags_json, basis_summary, content_sha256, created_at, published_at FROM case_version ORDER BY version_no DESC"
      );
      const byCase = new Map<string, AuthCaseVersion[]>();
      for (const v of verRows) {
        const cid = String(v.case_id);
        if (!byCase.has(cid)) byCase.set(cid, []);
        byCase.get(cid)!.push({
          id: String(v.id),
          versionNo: Number(v.version_no || 0),
          status: String(v.status || ""),
          input: parseJson(v.input_json),
          expected: parseJson(v.expected_json),
          tags: (parseJson(v.tags_json) as string[]) || [],
          basisSummary: String(v.basis_summary || ""),
          contentSha256: String(v.content_sha256 || ""),
          createdAt: String(v.created_at || ""),
          publishedAt: String(v.published_at || "")
        });
      }
      const cases = caseRows.map((c) => ({
        id: String(c.id),
        title: String(c.title || ""),
        sceneTag: String(c.scene_tag || ""),
        currentVersionId: String(c.current_version_id || ""),
        createdAt: String(c.created_at || ""),
        versions: byCase.get(String(c.id)) || []
      }));
      return { available: true, authoritative: true, source, cases };
    }
  );
}

export interface AuthorityReleasesResult {
  available: boolean;
  authoritative: boolean;
  source: string;
  reason?: string;
  releases: AuthorityRelease[];
}
export function readAuthorityReleases(dbPath?: string): AuthorityReleasesResult {
  const a = readAuthority(dbPath);
  return { available: a.available, authoritative: a.authoritative, source: a.source, reason: a.reason, releases: a.releases };
}

export interface AuthDatasetItem {
  seq: number;
  caseId: string;
  caseVersionId: string;
  versionNo: number;
  status: string;
  title: string;
  tags: string[];
}
export interface AuthorityDatasetResult {
  available: boolean;
  authoritative: boolean;
  source: string;
  reason?: string;
  versionId: string;
  dataset?: { id: string; name: string; description: string };
  version?: { id: string; datasetId: string; versionNo: number; status: string; caseCount: number; fingerprint: string; operators: string[]; createdAt: string; publishedAt: string };
  items: AuthDatasetItem[];
}

export function readAuthorityDataset(versionId: string, dbPath?: string): AuthorityDatasetResult {
  const empty: AuthorityDatasetResult = {
    available: false, authoritative: true, source: "", versionId, items: []
  };
  return withDataplatDb<AuthorityDatasetResult>(
    dbPath,
    (reason, source) => ({ ...empty, source, reason }),
    (db, source) => {
      const v = safeOne(db, "SELECT * FROM dataset_version WHERE id = ?", [versionId] as never);
      if (!v) return { ...empty, available: true, source, reason: "未找到该用例集版本" };
      const ds = safeOne(db, "SELECT id, name, description FROM dataset WHERE id = ?", [String(v.dataset_id)] as never);
      const itemRows = safeAll(
        db,
        "SELECT di.seq, di.case_version_id, cv.case_id, cv.version_no, cv.status, cv.tags_json, COALESCE(ec.title, '') AS title " +
          "FROM dataset_item di LEFT JOIN case_version cv ON cv.id = di.case_version_id " +
          "LEFT JOIN eval_case ec ON ec.id = cv.case_id WHERE di.dataset_version_id = ? ORDER BY di.seq",
        [versionId] as never
      );
      return {
        available: true,
        authoritative: true,
        source,
        versionId,
        dataset: ds ? { id: String(ds.id), name: String(ds.name || ""), description: String(ds.description || "") } : undefined,
        version: {
          id: String(v.id),
          datasetId: String(v.dataset_id || ""),
          versionNo: Number(v.version_no || 0),
          status: String(v.status || ""),
          caseCount: Number(v.case_count || 0),
          fingerprint: String(v.fingerprint || ""),
          operators: (parseJson(v.operators_json) as string[]) || [],
          createdAt: String(v.created_at || ""),
          publishedAt: String(v.published_at || "")
        },
        items: itemRows.map((r) => ({
          seq: Number(r.seq || 0),
          caseId: String(r.case_id || ""),
          caseVersionId: String(r.case_version_id || ""),
          versionNo: Number(r.version_no || 0),
          status: String(r.status || ""),
          title: String(r.title || ""),
          tags: (parseJson(r.tags_json) as string[]) || []
        }))
      };
    }
  );
}

export function readAuthority(dbPath?: string): AuthoritySummary {
  const source = dbPath || findDataplatDb() || "";
  const generatedAt = Date.now();
  const base: AuthoritySummary = {
    available: false,
    authoritative: true,
    source,
    generatedAt,
    releases: [],
    openFailures: [],
    pendingImports: 0,
    evalDb: readEvalDbInfo(findEvalplatDb()),
    totals: { releases: 0, runImports: 0, openFailures: 0 }
  };
  if (!source || !fs.existsSync(source)) {
    return { ...base, reason: "未找到数据中台库（可用环境变量 PI_DATAPLAT_DB 指定）" };
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(source, { readOnly: true });
  } catch {
    try {
      db = new DatabaseSync(source);
    } catch (e) {
      return { ...base, reason: "无法打开数据中台库：" + String(e).slice(0, 120) };
    }
  }
  try {
    const relRows = safeAll(
      db,
      "SELECT r.id, r.release_no, r.dataset_version_id, r.fingerprint, r.published_at, " +
        "a.version AS agent_version, dv.case_count " +
        "FROM release r LEFT JOIN agent a ON a.id = r.agent_id " +
        "LEFT JOIN dataset_version dv ON dv.id = r.dataset_version_id " +
        "ORDER BY r.published_at DESC"
    );
    const runRows = safeAll(
      db,
      "SELECT id, release_id, eval_run_id, subject_version, match_status, metrics_json, imported_at FROM run_import ORDER BY imported_at DESC"
    );
    const runsByRelease = new Map<string, AuthorityRun[]>();
    for (const r of runRows) {
      let m: any = {};
      try {
        m = JSON.parse(String(r.metrics_json || "{}"));
      } catch {
        m = {};
      }
      const item: AuthorityRun = {
        runImportId: String(r.id),
        evalRunId: String(r.eval_run_id),
        subjectVersion: String(r.subject_version || ""),
        matchStatus: String(r.match_status || ""),
        total: Number(m.total || 0),
        passed: Number(m.passed || 0),
        passRate: Number(m.pass_rate || 0),
        meanScore: Number(m.mean_score || 0),
        importedAt: String(r.imported_at || "")
      };
      const key = String(r.release_id);
      if (!runsByRelease.has(key)) runsByRelease.set(key, []);
      runsByRelease.get(key)!.push(item);
    }
    const releases: AuthorityRelease[] = relRows.map((r) => ({
      releaseNo: String(r.release_no),
      id: String(r.id),
      datasetVersionId: String(r.dataset_version_id || ""),
      caseCount: Number(r.case_count || 0),
      fingerprint: String(r.fingerprint || ""),
      agentVersion: String(r.agent_version || ""),
      publishedAt: String(r.published_at || ""),
      runs: runsByRelease.get(String(r.id)) || []
    }));
    const failRows = safeAll(
      db,
      "SELECT fr.id, fr.case_id, fr.category, fr.verdict, fr.root_cause, r.release_no " +
        "FROM failure_review fr JOIN run_import ri ON ri.id = fr.run_import_id " +
        "JOIN release r ON r.id = ri.release_id WHERE fr.verdict <> 'closed' ORDER BY fr.opened_at DESC"
    );
    const openFailures: AuthorityFailure[] = failRows.map((f) => ({
      id: String(f.id),
      releaseNo: String(f.release_no || ""),
      caseId: String(f.case_id || ""),
      category: String(f.category || ""),
      verdict: String(f.verdict || ""),
      rootCause: String(f.root_cause || "")
    }));
    const pendingRow = safeOne(db, "SELECT COUNT(*) AS n FROM pending_report");
    const pendingImports = Number((pendingRow && pendingRow.n) || 0);
    return {
      available: true,
      authoritative: true,
      source,
      generatedAt,
      releases,
      openFailures,
      pendingImports,
      evalDb: base.evalDb,
      totals: { releases: releases.length, runImports: runRows.length, openFailures: openFailures.length }
    };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}
