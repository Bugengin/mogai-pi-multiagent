import type { SubtaskResult, Conclusion } from "./types";

export interface PlannedSubtask {
  id: string;
  title: string;
  scope: string;
  hypothesis: string;
}

const EXPORT_RE = /导出|为空|空文件|文件.?空|空白文件|export/i;
const SIMPLE_RE = /^(你好|hi|hello|解释一下|说明一下)/i;

function isSimple(goal: string): boolean {
  const s = goal.trim();
  return s.length <= 10 || SIMPLE_RE.test(s);
}

export function isExportScenario(goal: string): boolean {
  return EXPORT_RE.test(goal);
}

const OUT_OF_SCOPE_RE = /报表|统计|时区|口径|营收|财务|指标对不上|数据对不上/;

/** 现有工作区是代码+日志，不覆盖业务报表/统计口径类主题；这类问题应明确说资料不足。 */
export function isOutOfScope(goal: string): boolean {
  return OUT_OF_SCOPE_RE.test(goal) && !isExportScenario(goal);
}

export function planSubtasks(goal: string): PlannedSubtask[] {
  if (isSimple(goal)) {
    return [
      {
        id: "s1",
        title: "直接处理",
        scope: "single",
        hypothesis: "单步即可完成，无需拆分"
      }
    ];
  }
  if (isOutOfScope(goal)) {
    return [
      { id: "s1", title: "核对资料覆盖", scope: "coverage", hypothesis: "现有资料未覆盖该主题" }
    ];
  }
  if (isExportScenario(goal)) {
    return [
      { id: "s1", title: "排查查询结果", scope: "query", hypothesis: "查询返回 0 行是根因" },
      { id: "s2", title: "排查文件写入", scope: "file-write", hypothesis: "写入层丢数据是根因" }
    ];
  }
  return [
    { id: "s1", title: "定位相关代码与日志", scope: "code", hypothesis: "问题出在代码逻辑" },
    { id: "s2", title: "验证运行时行为", scope: "runtime", hypothesis: "问题出在运行时或数据" }
  ];
}

export function stepsFor(goal: string, sub: { id: string; scope: string }): { text: string; delay: number }[] {
  if (isOutOfScope(goal)) {
    return [
      { text: "扫描工作区文件清单（代码 / 日志 / 复现）", delay: 600 },
      { text: "检索与「报表 / 统计口径 / 时区」相关的文件与配置：无命中", delay: 900 },
      { text: "确认现有资料不覆盖该主题", delay: 600 }
    ];
  }
  if (isExportScenario(goal)) {
    if (sub.id === "s1") {
      return [
        { text: "读取导出入口 exportService.ts:88", delay: 700 },
        { text: "追踪查询构造 queryBuilder.ts:18 -> WHERE status='PENDING'", delay: 900 },
        { text: "检索运行日志 logs/export-2026-11-19.log:88 -> rows=0", delay: 900 },
        { text: "确认 0 行发生在写文件之前", delay: 700 }
      ];
    }
    return [
      { text: "读取写文件逻辑 writer.ts:8", delay: 800 },
      { text: "检查空结果分支（只写表头）", delay: 800 },
      { text: "检查文件路径与权限正常", delay: 700 },
      { text: "尝试取写入阶段行数日志：未取到（证据偏弱）", delay: 800 }
    ];
  }
  if (sub.id === "s1") {
    return [
      { text: "扫描项目结构，定位可能相关模块", delay: 700 },
      { text: "阅读关键函数与最近改动", delay: 900 },
      { text: "检索日志中的异常堆栈", delay: 900 }
    ];
  }
  return [
    { text: "复现最小运行路径", delay: 800 },
    { text: "检查输入数据与配置", delay: 900 },
    { text: "对比预期与实际输出", delay: 800 }
  ];
}

export function resultFor(goal: string, sub: { id: string; scope: string }): SubtaskResult {
  if (isOutOfScope(goal)) {
    return {
      conclusion: "inconclusive" as Conclusion,
      summary: "现有工作区（代码与日志）里没有任何与「报表 / 统计口径 / 时区」相关的资料，无法判断根因。",
      evidence: [],
      doubts: ["需要补充统计口径与时区配置资料后再排查"],
      cost: { tokens: 1200, usd: 0.01 }
    };
  }
  if (isExportScenario(goal)) {
    if (sub.id === "s1") {
      return {
        conclusion: "confirmed" as Conclusion,
        summary: "查询过滤条件 status='PENDING' 导致 0 行；0 行在写文件之前已经发生。",
        evidence: [
          { type: "code", locator: "queryBuilder.ts:18", snippet: 'where("status", "PENDING")', verify: "去掉该 where 条件后复跑查询", supports: "查询过滤条件导致 0 行" },
          { type: "log", locator: "logs/export-2026-11-19.log:88", snippet: "rows=0", verify: "按导出 ID 过滤日志", supports: "0 行发生在写文件之前" }
        ],
        doubts: ["PENDING 状态本应有多少历史数据，未确认"],
        cost: { tokens: 8200, usd: 0.06 }
      };
    }
    return {
      conclusion: "refuted" as Conclusion,
      summary: "写入层正常：0 行时按设计只写表头，未发现写入丢数据。",
      evidence: [
        { type: "code", locator: "writer.ts:8", snippet: "if (rows.length === 0) return writeHeaderOnly()", verify: "单测 writer.spec.ts#empty", supports: "写入层按设计只写表头" },
        { type: "test", locator: "writer.spec.ts#empty", snippet: "PASS", verify: "npm test -- writer", supports: "空结果不写数据行" }
      ],
      doubts: ["缺少写入前后行数日志，无法定位丢失点", "下游压缩步骤未验证"],
      cost: { tokens: 6900, usd: 0.05 }
    };
  }
  if (sub.id === "s1") {
    return {
      conclusion: "confirmed" as Conclusion,
      summary: "问题集中在代码逻辑的一个边界情况。",
      evidence: [{ type: "code", locator: "src/core.ts:64", snippet: "edge case not handled", verify: "补一条边界单测" }],
      doubts: ["尚未在真实数据上复现"],
      cost: { tokens: 6100, usd: 0.04 }
    };
  }
  return {
    conclusion: "confirmed" as Conclusion,
    summary: "运行时输入里存在一条未处理的边界值，复现后已定位到具体条件。",
    evidence: [
      { type: "log", locator: "logs/app.log:204", snippet: "unexpected null -> fallback path", verify: "用同一条输入复跑" },
      { type: "test", locator: "repro/edge-case-17", snippet: "FAIL -> confirmed", verify: "回归该复现用例" }
    ],
    doubts: ["边界值来自上游哪一环还未确认"],
    cost: { tokens: 5400, usd: 0.03 }
  };
}

export interface CandidateSeed {
  id: string;
  title: string;
  why: string;
  confidence: "high" | "medium" | "low";
}

/** 巡检模式：在给定范围内侦察，产出候选问题清单供用户挑选 */
export function candidatesFor(goal: string, scope?: string): CandidateSeed[] {
  const where = scope && scope.trim() ? scope.trim() : "项目";
  const out: CandidateSeed[] = [];
  if (isExportScenario(goal) || /导出|export/i.test(scope || "")) {
    out.push({
      id: "c0",
      title: "导出文件为空：查询过滤把数据全过滤掉了",
      why: "巡检 " + where + " 时发现导出链路里查询条件 status='PENDING' 可能返回 0 行",
      confidence: "high"
    });
  }
  out.push({
    id: "c1",
    title: "接口偶发 500：疑似超时重试或空指针",
    why: "在 " + where + " 的日志里发现零星 5xx 与超时重试痕迹",
    confidence: "medium"
  });
  out.push({
    id: "c2",
    title: "报表数据对不上：疑似统计口径或时区偏差",
    why: "汇总表与明细表按天聚合可能存在时区偏差",
    confidence: "medium"
  });
  out.push({
    id: "c3",
    title: "后台任务堆积：疑似消费者被长事务卡住",
    why: "队列消费延迟升高，存在长事务阻塞的迹象",
    confidence: "low"
  });
  return out;
}
