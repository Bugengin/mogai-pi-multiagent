import fs from "node:fs";
import path from "node:path";
import type { Evidence } from "./types";

export interface VerifyResult {
  valid: boolean;
  reason: string;
}

function within(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** 校验证据是否真实可核验：文件存在、行号在范围内、片段能对上、测试用例存在 */
export function verifyEvidence(ev: Evidence, root: string): VerifyResult {
  try {
    if (ev.type === "test") {
      const parts = ev.locator.split("#");
      const filePart = parts[0];
      const caseName = parts.length > 1 ? parts[1] : "";
      const fp = path.resolve(root, filePart);
      if (!within(root, fp)) return { valid: false, reason: "路径越界: " + filePart };
      if (!fs.existsSync(fp)) return { valid: false, reason: "测试文件不存在: " + filePart };
      const content = fs.readFileSync(fp, "utf8");
      if (caseName && !content.includes(caseName)) return { valid: false, reason: "测试用例未找到: " + caseName };
      return { valid: true, reason: "测试文件与用例存在" };
    }

    const m = /^(.*):(\d+)$/.exec(ev.locator);
    if (!m) return { valid: false, reason: "定位格式应为 文件:行号" };
    const filePart = m[1];
    const line = parseInt(m[2], 10);
    const fp = path.resolve(root, filePart);
    if (!within(root, fp)) return { valid: false, reason: "路径越界: " + filePart };
    if (!fs.existsSync(fp)) return { valid: false, reason: "文件不存在: " + filePart };
    const content = fs.readFileSync(fp, "utf8");
    const lines = content.split(/\r?\n/);
    if (line < 1 || line > lines.length) {
      return { valid: false, reason: "行号超出范围: " + filePart + ":" + line + "（共 " + lines.length + " 行）" };
    }
    if (ev.snippet) {
      if (!content.includes(ev.snippet)) return { valid: false, reason: "依据片段未在文件中找到" };
      const lineText = lines[line - 1] || "";
      if (!lineText.includes(ev.snippet)) {
        return { valid: true, reason: "片段在文件中，但不在第 " + line + " 行（行号略有偏差）" };
      }
    }
    return { valid: true, reason: "文件与行号有效" };
  } catch (e) {
    return { valid: false, reason: "校验异常: " + String(e) };
  }
}
