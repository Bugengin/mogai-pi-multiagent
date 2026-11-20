import { useEffect, useRef, useState } from "react";
import { startTask, stopSubtask, retrySubtask, pickCandidate, listTasks, getTask, getSettings } from "./api";
import SettingsModal from "./SettingsModal";
import EvalPanel from "./EvalPanel";
import DataPanel from "./DataPanel";
import type { Task, Subtask, ServerEvent, TaskMode, TaskSummary } from "./types";

const STATUS_LABEL: Record<string, string> = {
  pending: "待办", running: "排查中", stuck: "卡住", done: "已完成", failed: "失败", stopped: "已停止",
  recon: "侦察中", awaiting_pick: "待选择", adjudicating: "仲裁中", planning: "规划中"
};
const CONCLUSION_LABEL: Record<string, string> = {
  confirmed: "成立", refuted: "排除", inconclusive: "证据不足"
};
const CONF_LABEL: Record<string, string> = {
  high: "高", medium: "中", low: "低", inconclusive: "不确定"
};

const CAPS = [
  { ico: "🧩", title: "任务拆分", desc: "主 Pi 把问题拆成可独立验证的子任务；简单问题不拆，避免过度拆分。" },
  { ico: "⚡", title: "并行只读排查", desc: "多个子智能体在各自会话里同时排查，只读代码与日志，不碰你的文件。" },
  { ico: "📎", title: "证据回传", desc: "每个子任务交回结论、依据（代码/日志/测试）、未验证疑点，并自动校验真伪。" },
  { ico: "⚖️", title: "分歧仲裁", desc: "结论矛盾时，主 Pi 设计一次判别性检查；证据不足就明说「还不能确定」。" }
];

const FLOW = [
  { n: "1", title: "拆解任务", desc: "主 Pi 读懂问题，拆成几条可验证的排查线。" },
  { n: "2", title: "并行排查", desc: "每个子智能体独立会话、只读排查，实时回传进展与证据。" },
  { n: "3", title: "仲裁根因", desc: "主 Pi 汇总证据、处理冲突，给出根因或「证据不足」。" }
];

const EXAMPLES = [
  { label: "导出文件为空", goal: "导出文件为空，帮我查一下原因" },
  { label: "接口偶尔 500", goal: "线上接口偶尔返回 500，帮我定位原因" },
  { label: "报表数据对不上", goal: "报表数据和明细对不上，帮我查是哪一步算错了" },
  { label: "CI 单测挂了", goal: "CI 上单元测试挂了，帮我查是哪次改动引入的" }
];

function isTerminal(s: string): boolean {
  return s === "done" || s === "stopped" || s === "failed";
}

function AgentPane(props: {
  taskId: string;
  sub: Subtask;
  onStop: (sid: string) => void;
  onRetry: (sid: string) => void;
}) {
  const sub = props.sub;
  const running = sub.status === "running";
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{sub.title} <span className="tag">{sub.scope}</span></div>
        <span className={"badge b-" + sub.status}>{STATUS_LABEL[sub.status] || sub.status}</span>
      </div>
      <div className="hypo">假设：{sub.hypothesis}</div>

      <div className="section-label">正在查 / 已查到</div>
      <div className="log">
        {running && <div className="line"><span className="spinner"></span>排查中…</div>}
        {sub.progress.map((p, i) => <div className="line" key={i}>{p}</div>)}
        {!running && sub.progress.length === 0 && <div className="line muted">（无进展）</div>}
      </div>

      {sub.result && (
        <div>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>结论</div>
            <span className={"badge b-" + sub.result.conclusion}>{CONCLUSION_LABEL[sub.result.conclusion]}</span>
          </div>
          <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.6 }}>{sub.result.summary}</div>
          <div className="section-label">依据（自动校验）</div>
          <ul className="evidence">
            {sub.result.evidence.map((e, i) => (
              <li key={i}>
                <span className="ev-type">{e.type}</span>
                <span className="ev-loc">{e.locator}</span>
                {e.valid === true && <span className="ev-ok">✓ 已校验</span>}
                {e.valid === false && <span className="ev-bad">✗ 校验未通过</span>}
                {e.snippet && <span className="ev-snip">{e.snippet}</span>}
              </li>
            ))}
          </ul>
          {sub.result.doubts.length > 0 && (
            <div>
              <div className="section-label">未验证的疑点</div>
              <ul className="doubts">{sub.result.doubts.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
          <div className="cost">消耗：{sub.result.cost.tokens} tokens · {sub.result.cost.usd.toFixed(3)} USD</div>
        </div>
      )}

      <div className="actions">
        <button className="btn-sm" disabled={!running} onClick={() => props.onStop(sub.id)}>停止</button>
        <button className="btn-sm" disabled={running} onClick={() => props.onRetry(sub.id)}>重试</button>
      </div>
    </div>
  );
}

function VerdictPanel(props: { task: Task }) {
  const task = props.task;
  const v = task.verdict;
  if (task.status === "adjudicating") {
    return (
      <div className="card verdict">
        <h3>主 Pi 仲裁中…</h3>
        <div className="muted"><span className="spinner"></span>正在做判别性检查、汇总证据</div>
      </div>
    );
  }
  if (!v) return null;
  const uncertain = v.confidence === "inconclusive" || !v.rootCause;
  return (
    <div className="card verdict">
      <h3>
        主 Pi 结论{" "}
        <span className={"badge b-" + (uncertain ? "inconclusive" : "confirmed")}>
          置信度：{CONF_LABEL[v.confidence]}
        </span>
      </h3>
      <div className={"rootcause" + (uncertain ? " uncertain" : "")}>
        {v.rootCause || "还不能确定根因（证据不足）"}
      </div>
      <div className="section-label">推理与仲裁</div>
      <ol className="reason">{v.reasoning.map((r, i) => <li key={i}>{r}</li>)}</ol>
      {v.discriminatingCheck && <div className="check"><b>判别性检查：</b>{v.discriminatingCheck}</div>}
      {v.unresolved.length > 0 && <div className="unresolved"><b>仍未解决：</b>{v.unresolved.join("；")}</div>}
    </div>
  );
}

function ReconView(props: { task: Task; onPick: (cid: string) => void }) {
  const task = props.task;
  if (task.status === "recon") {
    return (
      <div className="recon-banner">
        <span className="spinner"></span>
        正在侦察「{task.scope || "项目"}」…先摸清楚有哪些可能的坑，再让你挑
      </div>
    );
  }
  const cands = task.candidates || [];
  return (
    <div>
      <div className="section-label" style={{ marginTop: 4 }}>
        我在「{task.scope || "项目"}」里发现这些可能的问题，选一个深入排查
      </div>
      <div className="cand-grid">
        {cands.map((c) => (
          <button className="cand-card" key={c.id} onClick={() => props.onPick(c.id)}>
            <div className="cand-head">
              <span className="cand-title">{c.title}</span>
              <span className={"badge b-" + (c.confidence === "high" ? "confirmed" : c.confidence === "low" ? "inconclusive" : "pending")}>
                可信度：{CONF_LABEL[c.confidence]}
              </span>
            </div>
            <div className="cand-why">{c.why}</div>
            <div className="cand-go">点这条 → 深入排查</div>
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>巡检只是给方向，选中后才会拉起子智能体并行排查。</div>
    </div>
  );
}

export default function App() {
  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState("");
  const [mode, setMode] = useState<TaskMode>("diagnose");
  const [task, setTask] = useState<Task | null>(null);
  const [history, setHistory] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState<boolean>(() => new URLSearchParams(window.location.search).get("settings") === "1");
  const [engine, setEngine] = useState<string>("mock");
  const [tab, setTab] = useState<"workspace" | "eval" | "data">(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "eval" || t === "data" ? t : "workspace";
  });
  const esRef = useRef<EventSource | null>(null);

  async function refreshHistory() {
    try { setHistory(await listTasks()); } catch { /* ignore */ }
  }

  function apply(ev: ServerEvent) {
    if (ev.type === "task") {
      setTask(ev.task);
    } else if (ev.type === "subtask") {
      setTask((prev) => {
        if (!prev || prev.id !== ev.taskId) return prev;
        return { ...prev, subtasks: prev.subtasks.map((s) => (s.id === ev.subtask.id ? ev.subtask : s)) };
      });
    } else if (ev.type === "verdict") {
      setTask((prev) => (prev && prev.id === ev.taskId ? { ...prev, verdict: ev.verdict } : prev));
    }
  }

  function openStream(taskId: string) {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/tasks/" + taskId + "/events");
    es.onmessage = (e) => {
      try { apply(JSON.parse(e.data) as ServerEvent); } catch { /* ignore */ }
    };
    esRef.current = es;
  }

  async function runTask(g: string, m: TaskMode = mode, sc: string = scope) {
    if (loading) return;
    if (m === "diagnose" && !g.trim()) return;
    setLoading(true);
    try {
      const res = await startTask(g.trim(), m, sc.trim());
      setTask(res.task);
      openStream(res.taskId);
    } catch (err) {
      alert("启动失败：" + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadTask(id: string) {
    try {
      const t = await getTask(id);
      setTask(t);
      if (!isTerminal(t.status) && t.status !== "awaiting_pick") openStream(id);
    } catch (err) {
      alert("加载失败：" + String(err));
    }
  }

  function reset() {
    if (esRef.current) esRef.current.close();
    esRef.current = null;
    setTask(null);
    setGoal("");
  }

  async function onStop(sid: string) { if (task) await stopSubtask(task.id, sid); }
  async function onRetry(sid: string) { if (task) await retrySubtask(task.id, sid); }
  async function onPick(cid: string) { if (task) await pickCandidate(task.id, cid); }

  useEffect(() => {
    refreshHistory();
    getSettings().then((s) => setEngine(s.engine)).catch(() => undefined);
  }, []);
  useEffect(() => { if (!task) refreshHistory(); }, [task]);
  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  const header = (
    <div className="nav">
      <div className="brand"><span className="logo"></span>Pi 多智能体协作台</div>
      <div className="nav-tabs">
        <button className={tab === "workspace" ? "on" : ""} onClick={() => setTab("workspace")}>协作台</button>
        <button className={tab === "eval" ? "on" : ""} onClick={() => setTab("eval")}>评测</button>
        <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>数据</button>
      </div>
      <div className="nav-right">
        <button className={"engine-badge " + engine} onClick={() => setShowSettings(true)} title="引擎设置">引擎：{engine === "pi" ? "真实 Pi" : "Mock"}</button>
        {task && <button className="btn-ghost" onClick={reset}>换一个</button>}
        <button className="gear" onClick={() => setShowSettings(true)} title="设置">⚙</button>
      </div>
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} onSaved={(e) => setEngine(e)} />
    </div>
  );

  if (tab === "data") {
    return (
      <div className="app">
        {header}
        <DataPanel />
      </div>
    );
  }

  if (tab === "eval") {
    return (
      <div className="app">
        {header}
        <EvalPanel />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="app">
        {header}
        <section className="landing">
          <h1 className="hero-title">
            一句话描述问题，<span className="grad">Pi 自动拆给多个智能体并行排查</span>
          </h1>
          <p className="hero-sub">
            不知道问题在哪也行：交给它一个现象或一个范围，主 Pi 负责拆解与仲裁；每个子智能体在独立会话里只读排查，
            交回「结论 / 依据 / 还没验证的疑点」，依据会自动校验真伪。
          </p>

          <div className="caps">
            {CAPS.map((c) => (
              <div className="cap" key={c.title}>
                <div className="cap-ico">{c.ico}</div>
                <div className="cap-title">{c.title}</div>
                <div className="cap-desc">{c.desc}</div>
              </div>
            ))}
          </div>

          <div className="flow">
            {FLOW.map((f) => (
              <div className="flow-step" key={f.n}>
                <div className="flow-num">{f.n}</div>
                <div className="flow-title">{f.title}</div>
                <div className="flow-desc">{f.desc}</div>
              </div>
            ))}
          </div>

          <div className="examples">
            <div className="section-label">试试这些场景</div>
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button className="chip" key={ex.label} onClick={() => runTask(ex.goal, "diagnose", scope)}>{ex.label}</button>
              ))}
            </div>
          </div>

          <div className="moderow">
            <div className="seg">
              <button className={mode === "diagnose" ? "active" : ""} onClick={() => setMode("diagnose")}>我知道现象，直接排查</button>
              <button className={mode === "recon" ? "active" : ""} onClick={() => setMode("recon")}>我不确定，帮我先看看</button>
            </div>
            <input
              className="scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="范围（选填）：哪个项目 / 服务 / 日志目录"
            />
          </div>

          <div className="startbar">
            <input
              className="input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={mode === "recon"
                ? "可留空：只给范围就行，让它自己在里面找可能的问题"
                : "描述现象，例如：导出文件为空，帮我查一下原因"}
              onKeyDown={(e) => { if (e.key === "Enter") runTask(goal); }}
            />
            <button className="btn primary" onClick={() => runTask(goal)} disabled={loading}>
              {loading ? "启动中…" : mode === "recon" ? "帮我看看" : "开始排查"}
            </button>
          </div>

          {history.length > 0 && (
            <div className="hist">
              <div className="section-label">最近排查（已存本地，重启不丢）</div>
              <div className="hist-list">
                {history.map((h) => (
                  <button className="hist-item" key={h.id} onClick={() => loadTask(h.id)}>
                    <span className="hist-goal">{h.mode === "recon" ? "🧭 " : "🔎 "}{h.goal}</span>
                    <span className="hist-meta">
                      {h.mode === "recon" ? <span className="mode-tag">巡检</span> : null} {STATUS_LABEL[h.status] || h.status}
                      {h.confidence ? " · 置信度" + CONF_LABEL[h.confidence] : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  const isRecon = task.status === "recon" || task.status === "awaiting_pick";
  return (
    <div className="app">
      {header}
      <section className="workspace">
        <div className="taskbar">
          <div className="goal">
            {task.mode === "recon" ? "🧭 " : "🔎 "}
            {task.goal}
            {task.scope ? <span className="tag" style={{ marginLeft: 10 }}>范围：{task.scope}</span> : null}
          </div>
          <div className="taskbar-right">
            {typeof task.spentUsd === "number" && task.spentUsd > 0 ? (
              <span className="spent">{"$" + task.spentUsd.toFixed(3) + " · " + (task.spentTokens || 0) + " tokens"}</span>
            ) : null}
            <span className={"pill " + task.status}>{STATUS_LABEL[task.status] || task.status}</span>
          </div>
        </div>

        {isRecon ? (
          <ReconView task={task} onPick={onPick} />
        ) : (
          <div>
            <div className="grid">
              {task.subtasks.map((s) => (
                <AgentPane key={s.id} taskId={task.id} sub={s} onStop={onStop} onRetry={onRetry} />
              ))}
            </div>
            <VerdictPanel task={task} />
          </div>
        )}
      </section>
    </div>
  );
}