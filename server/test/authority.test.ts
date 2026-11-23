import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAuthority, readAuthorityMaterials, readAuthorityMaterial, readAuthorityCases, readAuthorityReleases, readAuthorityDataset } from "../src/authority";

function buildDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auth-"));
  const dbPath = path.join(dir, "dataplat.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE agent (id TEXT, version TEXT);" +
      "CREATE TABLE dataset_version (id TEXT, case_count INTEGER);" +
      "CREATE TABLE release (id TEXT, release_no TEXT, dataset_version_id TEXT, agent_id TEXT, fingerprint TEXT, published_at TEXT);" +
      "CREATE TABLE run_import (id TEXT, release_id TEXT, eval_run_id TEXT, subject_version TEXT, match_status TEXT, metrics_json TEXT, imported_at TEXT);" +
      "CREATE TABLE failure_review (id TEXT, run_import_id TEXT, case_id TEXT, category TEXT, verdict TEXT, root_cause TEXT, opened_at TEXT);" +
      "CREATE TABLE pending_report (id TEXT);"
  );
  db.exec("INSERT INTO agent VALUES ('a1','0.1.2-mock');");
  db.exec("INSERT INTO dataset_version VALUES ('dsv1',20);");
  db.exec("INSERT INTO release VALUES ('rel1','R003','dsv1','a1','fp1','2026-01-01');");
  db.exec("INSERT INTO run_import VALUES ('imp1','rel1','run1','0.1.2-mock','matched','{\"total\":20,\"passed\":20,\"pass_rate\":1,\"mean_score\":1}','2026-01-02');");
  db.exec("INSERT INTO failure_review VALUES ('fr1','imp1','c1','agent_bug','closed','x','2026-01-02');");
  db.close();
  return dbPath;
}

test("authority: reads releases/run imports and counts open failures", () => {
  const dbPath = buildDb();
  const a = readAuthority(dbPath);
  assert.equal(a.available, true);
  assert.equal(a.authoritative, true);
  assert.equal(a.totals.releases, 1);
  assert.equal(a.totals.runImports, 1);
  assert.equal(a.totals.openFailures, 0);
  assert.equal(a.releases[0].releaseNo, "R003");
  assert.equal(a.releases[0].caseCount, 20);
  assert.equal(a.releases[0].runs[0].evalRunId, "run1");
  assert.equal(a.releases[0].runs[0].passRate, 1);
});

test("authority: missing db reports unavailable with reason", () => {
  const a = readAuthority(path.join(os.tmpdir(), "definitely-not-exist-" + Date.now(), "dataplat.db"));
  assert.equal(a.available, false);
  assert.ok(a.reason);
});

function buildFullDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auth-full-"));
  const dbPath = path.join(dir, "dataplat.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE agent (id TEXT, version TEXT);" +
      "CREATE TABLE material (id TEXT, project_id TEXT, title TEXT, source_type TEXT, source_ref TEXT, original_filename TEXT, mime TEXT, size_bytes INTEGER, sha256_original TEXT, created_at TEXT);" +
      "CREATE TABLE material_version (id TEXT, material_id TEXT, version_no INTEGER, status TEXT, content_path TEXT, content_sha256 TEXT, effective_date TEXT, ingested_at TEXT, supersedes_id TEXT, notes TEXT);" +
      "CREATE TABLE material_section (id TEXT, material_version_id TEXT, seq INTEGER, heading TEXT, page_from INTEGER, page_to INTEGER, char_start INTEGER, char_end INTEGER, text_sha256 TEXT);" +
      "CREATE TABLE eval_case (id TEXT, project_id TEXT, sample_id TEXT, title TEXT, scene_tag TEXT, current_version_id TEXT, created_at TEXT);" +
      "CREATE TABLE case_version (id TEXT, case_id TEXT, version_no INTEGER, status TEXT, input_json TEXT, expected_json TEXT, tags_json TEXT, basis_summary TEXT, content_sha256 TEXT, created_by TEXT, created_at TEXT, submitted_at TEXT, approved_by TEXT, approved_at TEXT, published_at TEXT, retired_at TEXT, reject_reason TEXT);" +
      "CREATE TABLE case_evidence (id TEXT, case_version_id TEXT, material_version_id TEXT, section_id TEXT, locator TEXT, quote TEXT, quote_sha256 TEXT, required INTEGER, note TEXT);" +
      "CREATE TABLE dataset (id TEXT, project_id TEXT, name TEXT, description TEXT, status TEXT, created_at TEXT);" +
      "CREATE TABLE dataset_version (id TEXT, dataset_id TEXT, version_no INTEGER, status TEXT, case_count INTEGER, fingerprint TEXT, json_path TEXT, json_sha256 TEXT, operators_json TEXT, created_at TEXT, frozen_at TEXT, published_at TEXT, notes TEXT);" +
      "CREATE TABLE dataset_item (dataset_version_id TEXT, case_version_id TEXT, seq INTEGER);" +
      "CREATE TABLE release (id TEXT, project_id TEXT, release_no TEXT, name TEXT, dataset_version_id TEXT, agent_id TEXT, status TEXT, fingerprint TEXT, operators_json TEXT, published_at TEXT);" +
      "CREATE TABLE release_material (release_id TEXT, material_version_id TEXT);" +
      "CREATE TABLE run_import (id TEXT, release_id TEXT, eval_run_id TEXT, subject_version TEXT, match_status TEXT, metrics_json TEXT, imported_at TEXT);" +
      "CREATE TABLE failure_review (id TEXT, run_import_id TEXT, case_id TEXT, category TEXT, verdict TEXT, root_cause TEXT, opened_at TEXT);" +
      "CREATE TABLE pending_report (id TEXT);"
  );
  db.exec("INSERT INTO agent VALUES ('a1','0.1.2-mock');");
  db.exec("INSERT INTO material VALUES ('m1','p1','内部制度','file','财务部-2026.pdf','财务部-2026.pdf','application/pdf',123,'origsha','2026-01-01');");
  db.exec("INSERT INTO material_version VALUES ('mv1','m1',1,'published','p.md','abcdef0123456789','2026-01-01','2026-01-01',NULL,'');");
  db.exec("INSERT INTO material_section VALUES ('ms1','mv1',1,'第一章',1,3,0,100,'secsha');");
  db.exec("INSERT INTO eval_case VALUES ('ec1','p1',NULL,'导出为空','export','cv1','2026-01-01');");
  db.exec("INSERT INTO case_version VALUES ('cv1','ec1',1,'published','{\"args\":[\"x\"]}','{}','[\"export\"]','依据','casehash','','2026-01-01','','','','2026-01-01','','');");
  db.exec("INSERT INTO case_evidence VALUES ('ce1','cv1','mv1','ms1','M1 第一章','引用','qsha',1,'');");
  db.exec("INSERT INTO dataset VALUES ('ds1','p1','R003集','desc','active','2026-01-01');");
  db.exec("INSERT INTO dataset_version VALUES ('dsv1','ds1',1,'published',1,'fpds','datasets/dsv1/cases.json','json','[\"subset\"]','2026-01-01','2026-01-01','2026-01-01','');");
  db.exec("INSERT INTO dataset_item VALUES ('dsv1','cv1',1);");
  db.exec("INSERT INTO release VALUES ('rel1','p1','R003','','dsv1','a1','published','fpds','[\"subset\"]','2026-01-02');");
  db.exec("INSERT INTO release_material VALUES ('rel1','mv1');");
  db.exec("INSERT INTO run_import VALUES ('imp1','rel1','run1','0.1.2-mock','matched','{\"total\":1,\"passed\":1,\"pass_rate\":1,\"mean_score\":1}','2026-01-03');");
  db.exec("INSERT INTO failure_review VALUES ('fr1','imp1','ec1','agent_bug','closed','x','2026-01-03');");
  db.close();
  return dbPath;
}

test("authority: reads materials with versions and content fingerprint", () => {
  const dbPath = buildFullDb();
  const r = readAuthorityMaterials(dbPath);
  assert.equal(r.available, true);
  assert.equal(r.authoritative, true);
  assert.equal(r.materials.length, 1);
  assert.equal(r.materials[0].title, "内部制度");
  assert.equal(r.materials[0].versions[0].id, "mv1");
  assert.match(r.materials[0].versions[0].contentSha256, /^abcdef/);
});

test("authority: material detail includes sections and linked cases", () => {
  const dbPath = buildFullDb();
  const r = readAuthorityMaterial("m1", dbPath);
  assert.equal(r.available, true);
  assert.ok(r.material);
  assert.equal(r.material!.sections.length, 1);
  assert.equal(r.material!.linkedCases.length, 1);
  assert.equal(r.material!.linkedCases[0].caseId, "ec1");
});

test("authority: reads cases with case versions and tags", () => {
  const dbPath = buildFullDb();
  const r = readAuthorityCases(dbPath);
  assert.equal(r.available, true);
  assert.equal(r.cases.length, 1);
  assert.equal(r.cases[0].id, "ec1");
  assert.equal(r.cases[0].versions[0].id, "cv1");
  assert.deepEqual(r.cases[0].versions[0].tags, ["export"]);
});

test("authority: releases expose dataset linkage", () => {
  const dbPath = buildFullDb();
  const r = readAuthorityReleases(dbPath);
  assert.equal(r.available, true);
  assert.equal(r.releases[0].releaseNo, "R003");
  assert.equal(r.releases[0].datasetVersionId, "dsv1");
});

test("authority: dataset detail lists frozen case items", () => {
  const dbPath = buildFullDb();
  const r = readAuthorityDataset("dsv1", dbPath);
  assert.equal(r.available, true);
  assert.equal(r.version!.fingerprint, "fpds");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].caseId, "ec1");
  assert.equal(r.items[0].caseVersionId, "cv1");
});

test("authority: read-only APIs degrade clearly when db missing", () => {
  const missing = path.join(os.tmpdir(), "no-such-dataplat-" + Date.now(), "dataplat.db");
  assert.equal(readAuthorityMaterials(missing).available, false);
  assert.ok(readAuthorityMaterials(missing).reason);
  assert.equal(readAuthorityCases(missing).available, false);
  assert.equal(readAuthorityDataset("x", missing).available, false);
});

