import { useEffect, useState } from "react";
import { getEvalCases, runEval, getEvalRuns, listTasks, addEvalCase, getEvalTrends, getAuthority } from "./api";
import type { EvalCase, EvalRun, TrendPoint, AuthoritySummary } from "./api";
import Trends from "./Trends";
import StabilityPanel from "./StabilityPanel";
import type { TaskSummary } from "./types";

export default function EvalPanel() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [latest, setLatest] = useState<EvalRun | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [authority, setAuthority] = useState<AuthoritySummary | null>(null);
  const [repeats, setRepeats] = useState(1);
  const [aggregation, setAggregation] = useState<"average" | "all" | "majority">("majority");
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setCases(await getEvalCases("demo"));
      const rs = await getEvalRuns();
      setRuns(rs);
      if (rs[0]) setLatest(rs[0]);
      setTasks(await listTasks());
      setTrends(await getEvalTrends());
      setAuthority(await getAuthority());
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  async function run() {
    setBusy(true);
    try {
      const r = await runEval("demo", repeats, aggregation);
      setLatest(r);
      setRuns(await getEvalRuns());
      setTrends(await getEvalTrends());
    } catch (e) {
      alert("评测失败：" + String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addFromTask(t: TaskSummary) {
    const kw = window.prompt("期望根因关键词（逗号分隔，用于判定是否命中）", "");
    if (kw === null) return;
    const expect = kw.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    if (expect.length === 0) { alert("至少给一个关键词"); return; }
    await addEvalCase({ goal: t.goal, expect, tags: ["from-task"] });
    await load();
    alert("已加入评测集 ✓");
  }

  async function exportLatest() {
    if (!latest) return;
    const r = await fetch("/api/eval/runs/" + latest.id + "/export");
    if (!r.ok) { alert("导出失败: " + r.status); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = latest.id + ".evalplat.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = latest ? latest.summary : null;

  return (
    <div className="eval">
      <div className="eval-head">
        <div>
          <h2>评测 · 多智能体诊断质量</h2>
          <div className="muted">把一批已知根因的案例跑一遍，量「根因命中率 / 平均分 / 成本 / 耗时」，口径对齐评测中台。</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label className="muted" style={{ fontSize: 12 }}>重复次数</label>
          <input className="inp" type="number" min={1} max={10} value={repeats} onChange={(e) => setRepeats(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: 70 }} />
          <label className="muted" style={{ fontSize: 12 }}>聚合</label>
          <select className="inp" value={aggregation} onChange={(e) => setAggregation(e.target.value as "average" | "all" | "majority")} style={{ width: 110 }}>
            <option value="majority">majority</option>
            <option value="average">average</option>
            <option value="all">all</option>
          </select>
          <button className="btn-sm" onClick={exportLatest} disabled={!latest || busy}>导出 evalplat JSON</button>
          <button className="btn primary" onClick={run} disabled={busy}>{busy ? "评测中…" : "运行评测"}</button>
        </div>
      </div>

      {authority && (
        <div className="eval-card">
          <div className="section-label">权威结果来源 · 数据中台 {authority.available ? "✓ 已连接" : "（未连接）"}</div>
          {!authority.available ? (
            <div className="muted">{authority.reason || "未找到数据中台库"}</div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                数据权威库：{authority.source}
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                评测执行库：{authority.evalDb ? authority.evalDb.path : "-"}
                {authority.evalDb
                  ? authority.evalDb.available
                    ? "（" + authority.evalDb.runCount + " 次运行" + (authority.evalDb.hasR003 ? "，含 R003" : "") + "）"
                    : "（未连接）"
                  : ""}
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                发布 {authority.totals.releases} · 运行导入 {authority.totals.runImports} · 未关闭失败 {authority.totals.openFailures} · 待核对 {authority.pendingImports}
              </div>
              <table className="eval-table">
                <thead><tr><th>发布</th><th>用例集版本</th><th>用例数</th><th>产品版本</th><th>最近运行</th><th>通过率</th><th>比对</th></tr></thead>
                <tbody>
                  {authority.releases.map((r) => {
                    const run = r.runs[0];
                    return (
                      <tr key={r.id}>
                        <td>{r.releaseNo}</td>
                        <td>{r.datasetVersionId}</td>
                        <td>{r.caseCount}</td>
                        <td>{(run && run.subjectVersion) || r.agentVersion || "-"}</td>
                        <td>{run ? run.evalRunId : "-"}</td>
                        <td>{run ? Math.round(run.passRate * 100) + "%" : "-"}</td>
                        <td>{run ? <span className={"tagres " + (run.matchStatus === "matched" ? "pass" : "fail")}>{run.matchStatus}</span> : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>pi 本页下方为本地演示评测；正式结果以数据中台为准，未关闭失败应为 0。</div>
            </>
          )}
        </div>
      )}

      {s && (
        <div>
          <div className="eval-stats">
            <div className="stat"><div className="stat-n">{Math.round(s.passRate * 100)}%</div><div className="stat-l">通过率</div></div>
            <div className="stat"><div className="stat-n">{s.avgScore.toFixed(2)}</div><div className="stat-l">平均分</div></div>
            <div className="stat"><div className="stat-n">{s.sampleSize ?? s.total}</div><div className="stat-l">样本数</div></div>
            <div className="stat"><div className="stat-n">{"σ " + (s.scoreStdev ?? 0).toFixed(2)}</div><div className="stat-l">分数波动</div></div>
            <div className="stat"><div className="stat-n">{s.passed}/{s.total}</div><div className="stat-l">通过/总数</div></div>
            <div className="stat"><div className="stat-n">{"$" + s.totalUsd.toFixed(3)}</div><div className="stat-l">总成本</div></div>
            <div className="stat"><div className="stat-n">{s.avgMs}ms</div><div className="stat-l">平均耗时</div></div>
          </div>
          {latest && latest.meta && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              被测：{latest.meta.engine === "pi" ? "真实模型" : "Mock"} {latest.meta.provider ? latest.meta.provider + "/" : ""}{latest.meta.modelId || "-"}
              {" · 裁判："}{latest.meta.judgeModelId || "无（关键词）"}
              {" · 温度："}{latest.meta.temperature ?? "-"}
              {" · 重复："}{latest.meta.repeats ?? 1}
              {" · 聚合："}{latest.meta.aggregation || "majority"}
              {" · 裁判提示词："}{latest.meta.promptVersions?.judge || "-"}
              {s.passRateCi95 ? " · 通过率 95%CI：" + (s.passRateCi95[0] * 100).toFixed(0) + "%~" + (s.passRateCi95[1] * 100).toFixed(0) + "%" : ""}
            </div>
          )}
        </div>
      )}

      <Trends runs={trends} />

      <StabilityPanel />

      {latest && (
        <div className="eval-card">
          <div className="section-label">本次结果（{new Date(latest.createdAt).toLocaleString()}）</div>
          <table className="eval-table">
            <thead><tr><th>案例</th><th>结论摘要</th><th>分数</th><th>重复</th><th>结果</th><th>判分</th><th>评语</th><th>耗时</th><th>成本</th></tr></thead>
            <tbody>
              {latest.results.map((r) => [
                <tr key={r.caseId} onClick={() => setOpenCase(openCase === r.caseId ? null : r.caseId)} style={{ cursor: r.repeatResults ? "pointer" : "default" }}>
                  <td className="cell-goal">{r.goal}</td>
                  <td className="cell-actual">{r.actual || "（未得结论）"}</td>
                  <td>{r.score.toFixed(2)}</td>
                  <td>{r.repeats && r.repeats > 1 ? (r.passCount ?? 0) + "/" + r.repeats : "-"}</td>
                  <td><span className={"tagres " + (r.passed ? "pass" : "fail")}>{r.passed ? "通过" : "失败"}</span></td>
                  <td>{r.method === "llm" ? "LLM裁判" : "关键词"}</td>
                  <td className="cell-note">{r.judgeReason || "-"}</td>
                  <td>{r.ms}ms</td>
                  <td>{"$" + r.usd.toFixed(3)}</td>
                </tr>,
                openCase === r.caseId && r.repeatResults ? (
                  <tr key={r.caseId + "-detail"}>
                    <td colSpan={9} style={{ background: "#fafafa" }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        聚合：{r.aggregation || "majority"} · 通过 {r.passCount ?? 0}/{r.repeats ?? 0} · 平均分 {r.score.toFixed(2)} · 代表答案：最高分第 {(r.representativeIndex ?? 0) + 1} 次（{r.actualSource || "best"}）
                      </div>
                      <table className="eval-table">
                        <thead><tr><th>#</th><th>答案</th><th>分数</th><th>通过</th><th>状态</th><th>失败原因</th><th>耗时</th></tr></thead>
                        <tbody>
                          {r.repeatResults.map((x) => (
                            <tr key={x.index}>
                              <td>{x.index + 1}</td>
                              <td className="cell-actual">{x.actual || "（空）"}</td>
                              <td>{x.score.toFixed(2)}</td>
                              <td>{x.passed ? "✓" : "✗"}</td>
                              <td>{x.status}</td>
                              <td className="cell-note">{x.failureReason || "-"}</td>
                              <td>{x.ms}ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null
              ])}
            </tbody>
          </table>
        </div>
      )}

      <div className="eval-card">
        <div className="section-label">评测案例集（demo · {cases.length} 条）</div>
        <table className="eval-table">
          <thead><tr><th>ID</th><th>问题</th><th>期望关键词</th><th>标签</th></tr></thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td className="cell-goal">{c.goal}</td>
                <td>{c.expect.join("、")}</td>
                <td>{(c.tags || []).join("、")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="eval-card">
        <div className="section-label">数据中台 · 从历史排查沉淀评测案例</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>把排查过的任务一键变成回归用例，改动后重跑对比。</div>
        <table className="eval-table">
          <thead><tr><th>问题</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {tasks.slice(0, 8).map((t) => (
              <tr key={t.id}>
                <td className="cell-goal">{t.goal}</td>
                <td>{t.status}</td>
                <td><button className="btn-sm" onClick={() => addFromTask(t)}>加入评测集</button></td>
              </tr>
            ))}
            {tasks.length === 0 && <tr><td colSpan={3} className="muted">还没有历史任务</td></tr>}
          </tbody>
        </table>
      </div>

      {runs.length > 1 && (
        <div className="eval-card">
          <div className="section-label">历史评测</div>
          <table className="eval-table">
            <thead><tr><th>时间</th><th>通过率</th><th>平均分</th><th>总成本</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{Math.round(r.summary.passRate * 100)}%</td>
                  <td>{r.summary.avgScore.toFixed(2)}</td>
                  <td>{"$" + r.summary.totalUsd.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}