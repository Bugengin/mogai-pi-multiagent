import fs from "node:fs";
import path from "node:path";
import type { Evidence } from "./types";

export interface VerifyResult {
  valid: boolean;
  reason: string;
  fileExists: boolean;
  lineMatches: boolean | null;
  snippetFound: boolean | null;
}

function within(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** 校验证据是否真实可核验：文件存在、行号在范围内、片段能对上、测试用例存在。 */
export function verifyEvidence(ev: Evidence, root: string): VerifyResult {
  try {
    if (ev.type === "test") {
      const parts = ev.locator.split("#");
      const filePart = parts[0];
      const caseName = parts.length > 1 ? parts[1] : "";
      const fp = path.resolve(root, filePart);
      if (!within(root, fp)) {
        return { valid: false, reason: "路径越界: " + filePart, fileExists: false, lineMatches: null, snippetFound: null };
      }
      if (!fs.existsSync(fp)) {
        return { valid: false, reason: "测试文件不存在: " + filePart, fileExists: false, lineMatches: null, snippetFound: null };
      }
      const content = fs.readFileSync(fp, "utf8");
      if (caseName && !content.includes(caseName)) {
        return { valid: false, reason: "测试用例未找到: " + caseName, fileExists: true, lineMatches: null, snippetFound: false };
      }
      return { valid: true, reason: "测试文件与用例存在", fileExists: true, lineMatches: null, snippetFound: true };
    }

    const m = /^(.*):(\d+)$/.exec(ev.locator);
    if (!m) {
      return { valid: false, reason: "定位格式应为 文件:行号", fileExists: false, lineMatches: null, snippetFound: null };
    }
    const filePart = m[1];
    const line = parseInt(m[2], 10);
    const fp = path.resolve(root, filePart);
    if (!within(root, fp)) {
      return { valid: false, reason: "路径越界: " + filePart, fileExists: false, lineMatches: null, snippetFound: null };
    }
    if (!fs.existsSync(fp)) {
      return { valid: false, reason: "文件不存在: " + filePart, fileExists: false, lineMatches: null, snippetFound: null };
    }
    const content = fs.readFileSync(fp, "utf8");
    const lines = content.split(/\r?\n/);
    const snippetFound = ev.snippet ? content.includes(ev.snippet) : null;
    if (line < 1 || line > lines.length) {
      return {
        valid: false,
        reason: "行号超出范围: " + filePart + ":" + line + "（共 " + lines.length + " 行）",
        fileExists: true,
        lineMatches: false,
        snippetFound,
      };
    }
    if (ev.snippet) {
      if (!snippetFound) {
        return { valid: false, reason: "依据片段未在文件中找到", fileExists: true, lineMatches: false, snippetFound: false };
      }
      const lineText = lines[line - 1] || "";
      if (!lineText.includes(ev.snippet)) {
        return {
          valid: false,
          reason: "片段在文件中，但不在第 " + line + " 行（行号不匹配）",
          fileExists: true,
          lineMatches: false,
          snippetFound: true,
        };
      }
      return { valid: true, reason: "文件、行号与片段均匹配", fileExists: true, lineMatches: true, snippetFound: true };
    }
    return { valid: true, reason: "文件与行号有效", fileExists: true, lineMatches: true, snippetFound: null };
  } catch (e) {
    return { valid: false, reason: "校验异常: " + String(e), fileExists: false, lineMatches: null, snippetFound: null };
  }
}
