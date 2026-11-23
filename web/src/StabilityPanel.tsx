import { useEffect, useState } from "react";
import { getStability } from "./api";
import type { StabilityResult } from "./api";

export default function StabilityPanel() {
  const [data, setData] = useState<StabilityResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setData(await getStability()); } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="eval-card"><div className="muted">加载稳定性数据…</div></div>;
  if (!data || !data.available) {
    return (
      <div className="eval-card">
        <div className="section-label">真实引擎稳定性</div>
        <div className="muted">{(data && data.reason) || "暂无真实运行数据（未找到 evalplat.db 或 pi-multiagent@0.1.2-real 的运行）"}</div>
      </div>
    );
  }

  const a = data.acceptance || [];
  const ft = data.failureTypes || {};
  return (
    <div className="eval-card">
      <div className="section-label">
        真实引擎稳定性 · {data.subject}@{data.version}（{data.rounds.length} 轮 / {data.accuracy.units} 样本）
      </div>
      <div className="eval-stats">
        <div className="stat"><div className="stat-n">{Math.round(data.accuracy.passRate * 100)}%</div><div className="stat-l">总通过率</div></div>
        <div className="stat"><div className="stat-n">{Math.round(data.stability.meanCasePassRate * 100)}%</div><div className="stat-l">用例平均通过率</div></div>
        <div className="stat"><div className="stat-n">{Math.round(data.stability.flipRate * 100)}%</div><div className="stat-l">结果翻转率</div></div>
        <div className="stat"><div className="stat-n">{"σ " + data.stability.meanScoreStdev.toFixed(2)}</div><div className="stat-l">分数波动</div></div>
        <div className="stat"><div className="stat-n">{Math.round(data.infra.infraErrorRate * 100)}%</div><div className="stat-l">基础设施失败率</div></div>
        <div className="stat"><div className="stat-n">{data.resources.p95LatencyMs}ms</div><div className="stat-l">P95 耗时</div></div>
        <div className="stat"><div className="stat-n">{"$" + data.resources.avgCostUsd.toFixed(3)}</div><div className="stat-l">单条成本</div></div>
      </div>

      <div className="section-label" style={{ marginTop: 12 }}>失败类型分布</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {Object.keys(ft).sort().map((k) => (
          <span key={k} className={"tagres " + (k === "passed" ? "pass" : k === "guarded" ? "pending" : "fail")}>{k}: {ft[k]}</span>
        ))}
      </div>

      <div className="section-label">验收阈值</div>
      <table className="eval-table">
        <thead><tr><th>检查项</th><th>实际</th><th>阈值</th><th>结果</th></tr></thead>
        <tbody>
          {a.map((x) => (
            <tr key={x.name}>
              <td>{x.name}</td>
              <td>{x.value}</td>
              <td>{x.op + " " + x.threshold}</td>
              <td>{x.pass ? "✅ 通过" : "❌ 未达标"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-label" style={{ marginTop: 12 }}>逐用例跨轮稳定性</div>
      <table className="eval-table">
        <thead><tr><th>用例</th><th>通过/轮次</th><th>通过率</th><th>均分</th><th>标准差</th><th>翻转</th><th>空结论</th><th>各轮状态</th></tr></thead>
        <tbody>
          {data.cases.map((c) => (
            <tr key={c.caseId}>
              <td className="cell-goal">{c.caseId}</td>
              <td>{c.passedCount + "/" + c.rounds}</td>
              <td>{Math.round(c.passRate * 100) + "%"}</td>
              <td>{c.scoreMean.toFixed(2)}</td>
              <td>{c.scoreStdev.toFixed(2)}</td>
              <td>{c.flips}</td>
              <td>{c.emptyCount}</td>
              <td className="cell-note">{c.statuses.join(" / ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
