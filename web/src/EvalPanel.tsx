import { useEffect, useState } from "react";
import { getEvalCases, runEval, getEvalRuns, listTasks, addEvalCase, getEvalTrends } from "./api";
import type { EvalCase, EvalRun, TrendPoint } from "./api";
import Trends from "./Trends";
import type { TaskSummary } from "./types";

export default function EvalPanel() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [latest, setLatest] = useState<EvalRun | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setCases(await getEvalCases("demo"));
      const rs = await getEvalRuns();
      setRuns(rs);
      if (rs[0]) setLatest(rs[0]);
      setTasks(await listTasks());
      setTrends(await getEvalTrends());
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  async function run() {
    setBusy(true);
    try {
      const r = await runEval("demo");
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
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-sm" onClick={exportLatest} disabled={!latest || busy}>导出 evalplat JSON</button>
          <button className="btn primary" onClick={run} disabled={busy}>{busy ? "评测中…" : "运行评测"}</button>
        </div>
      </div>

      {s && (
        <div className="eval-stats">
          <div className="stat"><div className="stat-n">{Math.round(s.passRate * 100)}%</div><div className="stat-l">通过率</div></div>
          <div className="stat"><div className="stat-n">{s.avgScore.toFixed(2)}</div><div className="stat-l">平均分</div></div>
          <div className="stat"><div className="stat-n">{"$" + s.totalUsd.toFixed(3)}</div><div className="stat-l">总成本</div></div>
          <div className="stat"><div className="stat-n">{s.avgMs}ms</div><div className="stat-l">平均耗时</div></div>
          <div className="stat"><div className="stat-n">{s.passed}/{s.total}</div><div className="stat-l">通过/总数</div></div>
        </div>
      )}

      <Trends runs={trends} />

      {latest && (
        <div className="eval-card">
          <div className="section-label">本次结果（{new Date(latest.createdAt).toLocaleString()}）</div>
          <table className="eval-table">
            <thead><tr><th>案例</th><th>结论摘要</th><th>分数</th><th>结果</th><th>判分</th><th>评语</th><th>耗时</th><th>成本</th></tr></thead>
            <tbody>
              {latest.results.map((r) => (
                <tr key={r.caseId}>
                  <td className="cell-goal">{r.goal}</td>
                  <td className="cell-actual">{r.actual || "（未得结论）"}</td>
                  <td>{r.score.toFixed(2)}</td>
                  <td><span className={"tagres " + (r.passed ? "pass" : "fail")}>{r.passed ? "通过" : "失败"}</span></td>
                  <td>{r.method === "llm" ? "LLM裁判" : "关键词"}</td>
                  <td className="cell-note">{r.judgeReason || "-"}</td>
                  <td>{r.ms}ms</td>
                  <td>{"$" + r.usd.toFixed(3)}</td>
                </tr>
              ))}
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