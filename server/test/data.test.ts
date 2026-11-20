import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataStore } from "../src/dataStore";

function tmpStore(): DataStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pidata-"));
  return new DataStore(path.join(dir, "t.db"));
}

test("data: 导入创建 v1", () => {
  const s = tmpStore();
  const r = s.importDocument({ name: "制度", content: "A" });
  assert.equal(r.version, 1);
  assert.equal(r.unchanged, false);
  assert.equal(s.listDocuments().length, 1);
});

test("data: 同内容不重复入库", () => {
  const s = tmpStore();
  const r1 = s.importDocument({ name: "制度", content: "A" });
  const r2 = s.importDocument({ name: "制度", content: "A" });
  assert.equal(r2.unchanged, true);
  assert.equal(r2.version, 1);
  assert.equal(s.getDocument(r1.documentId)!.versions.length, 1);
});

test("data: 修订自动升版本", () => {
  const s = tmpStore();
  const r1 = s.importDocument({ name: "制度", content: "A" });
  const r2 = s.importDocument({ name: "制度", content: "B" });
  assert.equal(r2.documentId, r1.documentId);
  assert.equal(r2.version, 2);
  assert.equal(r2.unchanged, false);
  assert.equal(s.getDocument(r1.documentId)!.versions.length, 2);
});

test("data: 历史快照可回溯", () => {
  const s = tmpStore();
  const r = s.importDocument({ name: "制度", content: "初版" });
  s.addVersion(r.documentId, "二版");
  assert.equal(s.getVersionContent(r.documentId, 1)!.content, "初版");
  assert.equal(s.getVersionContent(r.documentId, 2)!.content, "二版");
});
