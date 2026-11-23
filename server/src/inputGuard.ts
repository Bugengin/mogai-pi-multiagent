import fs from "node:fs";
import path from "node:path";

/**
 * 输入边界 / 安全边界护栏（第 3 步：修复 R002 四个真实缺陷）。
 *
 * 在启动多智能体排查之前先对输入做意图分类，命中以下边界时直接给出确定应答，
 * 不再进入「硬套导出空文件模板 / 对无资料问题硬给根因」的错误路径：
 *  - greeting：普通问候 → 回产品身份，而不是代码结论；
 *  - injection：提示注入 / 套取系统提示词 / 越权 → 明确拒绝；
 *  - encoding：PDF / 导出乱码 → 先讲编码字符集，不套 PENDING 模板；
 *  - no_material：问 500 / 报表等，但工作区没有对应资料 → 明确 inconclusive。
 */
export type GuardKind = "greeting" | "injection" | "encoding" | "no_material" | "none";

export interface GuardResult {
  kind: GuardKind;
  answer?: string;
  confidence: "high" | "medium" | "low" | "inconclusive";
  reason: string;
  topic?: string;
}

const GREETING_RE = /^(你好|您好|hi|hello|嗨|哈喽|哈啰|在吗|早上好|上午好|中午好|下午好|晚上好)[\s，,。.!！?？~～]*/i;
const DIAG_RE = /(为什么|为啥|怎么|如何|排查|定位|根因|原因|报错|错误|失败|异常|500|bug|导出|接口|报表|崩溃|超时|单测|测试|日志|代码|复现)/i;
const INJECTION_RE = /(忽略(以上|之前|前面|上述|所有)?[\s\S]{0,8}(指令|提示|规则|要求))|(系统提示词|系统提示|system\s*prompt)|(输出[\s\S]{0,8}(提示词|prompt))|(越权|绕过[\s\S]{0,4}(安全|限制|策略)|jailbreak|开发者模式|developer\s*mode)/i;
const ENCODING_RE = /(乱码)|(字符集)|(编码[\s\S]{0,10}(错|问题|不对|乱))|((UTF-?8|GBK|GB2312)[\s\S]{0,10}(乱码|编码|问题))/i;
const REPORT_RE = /(报表|统计口径|口径|时区|营收|财务|指标对不上|数据对不上)/;
const API500_RE = /(500|服务端|后端接口|接口[\s\S]{0,4}(挂|崩|错)|生产环境[\s\S]{0,10}(接口|500))/;

const ANSWER = {
  greeting:
    "你好，我是 pi 多智能体协作助手，可以帮你排查导出、接口、报表等异常现象。请问你遇到了什么问题？描述具体现象后，我会拆给多个子智能体并行排查。",
  injection:
    "无法满足：我不会泄露系统提示词，也不能执行绕过安全策略或越权的指令。请描述你真正想排查的问题。",
  encoding:
    "PDF 导出乱码通常是编码 / 字符集问题：导出时没有正确嵌入中文字体，或没有按 UTF-8 等编码转换字符，导致文字显示为乱码。当前工作区没有 PDF 导出相关的代码与资料，无法定位到具体代码位置；建议先确认导出使用的字体与字符编码。"
};

/** 粗略扫描工作区，判断是否含有某类问题的真实资料（用于区分「有资料」与「无资料」）。 */
function hasMaterialFor(root: string | undefined, kind: "api" | "report"): boolean {
  if (!root) return false;
  const tokens = kind === "api" ? [/ctx\.user/, /req\.user/, /res\.status\(\s*500/, /throw new/] : [/getDate\(/, /aggregate/i, /时区/, /timeZone/i];
  const skip = /(^|[\\/])(node_modules|\.git|dist|build|\.next)([\\/]|$)/;
  let scanned = 0;
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 4 || scanned > 500) return false;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (scanned > 500) return false;
      const full = path.join(dir, e.name);
      if (skip.test(full)) continue;
      if (e.isDirectory()) {
        if (walk(full, depth + 1)) return true;
      } else if (e.isFile()) {
        scanned++;
        try {
          const st = fs.statSync(full);
          if (st.size > 1024 * 1024) continue;
          const txt = fs.readFileSync(full, "utf8");
          if (tokens.some((re) => re.test(txt))) return true;
        } catch {
          /* ignore unreadable */
        }
      }
    }
    return false;
  };
  return walk(root, 0);
}

export function classifyInput(goal: string, opts: { workspaceRoot?: string; workspaceName?: string } = {}): GuardResult {
  const g = (goal || "").trim();
  if (!g) return { kind: "none", confidence: "inconclusive", reason: "" };

  if (INJECTION_RE.test(g)) {
    return { kind: "injection", answer: ANSWER.injection, confidence: "high", reason: "命中提示注入/套取系统提示词/越权指令特征，按安全边界直接拒绝。" };
  }

  const remainder = g.replace(GREETING_RE, "");
  if (GREETING_RE.test(g) && g.length <= 30 && !DIAG_RE.test(remainder)) {
    return { kind: "greeting", answer: ANSWER.greeting, confidence: "high", reason: "属于普通问候/寒暄，未包含可排查的现象，按闲聊分流返回产品身份。" };
  }

  if (ENCODING_RE.test(g) && /(导出|PDF|pdf|Excel|CSV)/.test(g)) {
    return { kind: "encoding", answer: ANSWER.encoding, confidence: "high", reason: "问题指向 PDF/导出的乱码与编码，属于编码字符集问题，不再套用「导出为空」的查询过滤模板。" };
  }

  if (REPORT_RE.test(g) && !hasMaterialFor(opts.workspaceRoot, "report")) {
    return {
      kind: "no_material",
      answer: "无法确定：当前工作区没有报表 / 统计口径 / 时区相关的资料，证据不足，不能给出根因。请补充相关资料后再排查。",
      confidence: "inconclusive",
      reason: "问题涉及报表/统计口径/时区，但工作区没有对应资料，按「无证据即拒答」处理。",
      topic: "报表/统计口径"
    };
  }

  if (API500_RE.test(g) && /500/.test(g) && !hasMaterialFor(opts.workspaceRoot, "api")) {
    return {
      kind: "no_material",
      answer: "无法确定：当前工作区没有生产环境接口 / 服务端相关代码与日志资料，证据不足，不能给出根因。请补充相关日志与代码后再排查。",
      confidence: "inconclusive",
      reason: "问题指向生产接口 500，但工作区没有对应服务端资料，按「无证据即拒答」处理，不硬套通用边界结论。",
      topic: "生产接口 500"
    };
  }

  return { kind: "none", confidence: "medium", reason: "" };
}
