import type { TrendPoint } from "./api";

function Chart(props: { title: string; values: number[]; kind: "line" | "bar"; fmt: (v: number) => string }) {
  const { title, values, kind, fmt } = props;
  const w = 260, h = 92, pad = 10;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const n = values.length;
  const scaleY = (v: number) => h - pad - ((v - min) / ((max - min) || 1)) * (h - 2 * pad);
  const xs = n <= 1 ? [w / 2] : values.map((_, i) => pad + (i * (w - 2 * pad)) / (n - 1));
  const last = values[n - 1];
  return (
    <div className="chart">
      <div className="chart-title">{title} <span className="chart-last">{fmt(last)}</span></div>
      <svg viewBox={"0 0 " + w + " " + h} width="100%" height={h} preserveAspectRatio="none">
        {kind === "bar"
          ? values.map((v, i) => {
              const slot = (w - 2 * pad) / n;
              const bw = slot * 0.6;
              const x = pad + i * slot + (slot - bw) / 2;
              const y = scaleY(v);
              return <rect key={i} x={x} y={y} width={bw} height={Math.max(1, h - pad - y)} rx={2} fill="#4f6bed" opacity={0.72} />;
            })
          : (
            <polyline points={values.map((v, i) => xs[i] + "," + scaleY(v)).join(" ")} fill="none" stroke="#4f6bed" strokeWidth="2" />
          )}
        {kind === "line" && values.map((v, i) => <circle key={i} cx={xs[i]} cy={scaleY(v)} r="2.5" fill="#4f6bed" />)}
      </svg>
    </div>
  );
}

export default function Trends(props: { runs: TrendPoint[] }) {
  const runs = props.runs;
  if (!runs.length) return <div className="eval-card"><div className="section-label">趋势</div><div className="muted">还没有评测历史</div></div>;
  return (
    <div className="eval-card">
      <div className="section-label">成本 / 耗时 / 质量 趋势（最近 {runs.length} 次评测）</div>
      <div className="trend-grid">
        <Chart title="通过率" values={runs.map((r) => r.passRate)} kind="line" fmt={(v) => (v * 100).toFixed(0) + "%"} />
        <Chart title="平均分" values={runs.map((r) => r.avgScore)} kind="line" fmt={(v) => v.toFixed(2)} />
        <Chart title="单次成本" values={runs.map((r) => r.totalUsd)} kind="bar" fmt={(v) => "$" + v.toFixed(3)} />
        <Chart title="平均耗时" values={runs.map((r) => r.avgMs)} kind="bar" fmt={(v) => Math.round(v) + "ms"} />
      </div>
    </div>
  );
}
