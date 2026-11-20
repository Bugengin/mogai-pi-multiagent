// 清空测试数据：任务/子任务、资料版本、评测历史（保留 eval_cases.json 与 settings.json）
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "..", ".data");
const db = new DatabaseSync(path.join(dataDir, "pi.db"));
for (const t of ["subtasks", "tasks", "doc_versions", "documents"]) {
  try { db.prepare("DELETE FROM " + t).run(); } catch { /* table may not exist */ }
}
try { db.exec("VACUUM;"); } catch { /* ignore */ }
db.close();
fs.writeFileSync(path.join(dataDir, "eval_runs.json"), "[]", "utf8");
console.log("已清空测试数据（任务/资料/评测历史）。保留 eval_cases.json（评测用例集）与 settings.json。");
