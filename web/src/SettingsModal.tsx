import { useEffect, useState } from "react";
import { getSettings, saveSettings, discoverModels, testSettings } from "./api";

export default function SettingsModal(props: { open: boolean; onClose: () => void; onSaved: (engine: string) => void }) {
  const [provider, setProvider] = useState("openai");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [engine, setEngine] = useState<"mock" | "pi">("mock");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [maxTaskSeconds, setMaxTaskSeconds] = useState(300);
  const [maxCostUsd, setMaxCostUsd] = useState(1.5);
  const [maxConcurrency, setMaxConcurrency] = useState(4);
  const [stuckSeconds, setStuckSeconds] = useState(90);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    (async () => {
      try {
        const s = await getSettings();
        setEngine(s.engine); setProvider(s.provider); setModelId(s.modelId || "");
        setBaseUrl(s.baseUrl || ""); setHasApiKey(s.hasApiKey); setProviders(s.providers || []);
        setMaxTaskSeconds(s.maxTaskSeconds); setMaxCostUsd(s.maxCostUsd);
        setMaxConcurrency(s.maxConcurrency); setStuckSeconds(s.stuckSeconds);
        setModels([]); setApiKey(""); setMsg("");
      } catch (e) { setMsg("读取设置失败：" + String(e)); }
    })();
  }, [props.open]);

  function onProviderChange(p: string) {
    setProvider(p);
    setModels([]);
  }

  async function discover() {
    setBusy(true);
    setMsg("正在用该 Key 查询可用模型…");
    try {
      const r = await discoverModels({ provider, apiKey: apiKey || undefined, baseUrl });
      if (r.ok && r.models) {
        setModels(r.models);
        setMsg("发现 " + r.models.length + " 个可用模型");
        if (r.models.length > 0 && !modelId) setModelId(r.models[0].id);
      } else {
        setMsg("❌ " + (r.message || "未获取到模型"));
      }
    } catch (e) { setMsg("获取失败：" + String(e)); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setMsg("");
    try {
      const body: Record<string, unknown> = {
        engine, provider, modelId, baseUrl,
        maxTaskSeconds: Number(maxTaskSeconds) || 300,
        maxCostUsd: Number(maxCostUsd) || 0,
        maxConcurrency: Number(maxConcurrency) || 4,
        stuckSeconds: Number(stuckSeconds) || 90
      };
      if (apiKey) body.apiKey = apiKey;
      const s = await saveSettings(body);
      setHasApiKey(s.hasApiKey); setApiKey(""); props.onSaved(s.engine);
      setMsg("已保存 ✓");
    } catch (e) { setMsg("保存失败：" + String(e)); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg("测试中…（会真实调用一次模型）");
    try {
      const r = await testSettings({ provider, modelId, apiKey: apiKey || undefined, baseUrl });
      setMsg((r.ok ? "✅ " : "❌ ") + r.message);
    } catch (e) { setMsg("测试失败：" + String(e)); } finally { setBusy(false); }
  }

  if (!props.open) return null;
  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>引擎设置</h3>
          <button className="modal-x" onClick={props.onClose}>✕</button>
        </div>

        <div className="field">
          <label>引擎</label>
          <div className="seg">
            <button className={engine === "mock" ? "active" : ""} onClick={() => setEngine("mock")}>Mock · 演示不烧钱</button>
            <button className={engine === "pi" ? "active" : ""} onClick={() => setEngine("pi")}>真实 Pi</button>
          </div>
        </div>

        <div className="field">
          <label>供应商</label>
          <select className="inp" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="hint">认证方式：OpenAI/Groq/Mistral/DeepSeek/xAI = Authorization Bearer；Anthropic = x-api-key；Google = query key。</div>
        </div>

        <div className="field">
          <label>API Key {hasApiKey && <span className="saved-tag">已保存</span>}</label>
          <input className="inp" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasApiKey ? "已保存，留空则保持不变" : "粘贴你的 API Key"} />
        </div>

        <div className="field">
          <label>模型</label>
          {models.length > 0 ? (
            <select className="inp" value={modelId} onChange={(e) => setModelId(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.id}{m.name && m.name !== m.id ? " · " + m.name : ""}</option>)}
            </select>
          ) : (
            <input className="inp" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="先点「获取可用模型」，或用该 Key 支持的模型名" />
          )}
          <div style={{ marginTop: 8 }}>
            <button className="btn-sm" onClick={discover} disabled={busy}>获取可用模型</button>
            {models.length > 0 && <span className="hint" style={{ marginLeft: 8 }}>共 {models.length} 个（来自该 Key）</span>}
          </div>
        </div>

        <div className="field">
          <label>Base URL（选填） <button type="button" className="btn-sm" style={{ marginLeft: 8, padding: "2px 8px" }} onClick={() => setBaseUrl("")}>清空，走官方端点</button></label>
          <input className="inp" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="留空用官方端点；自建/中转才填" />
          {baseUrl ? <div className="hint" style={{ color: "var(--warn)" }}>当前使用自定义端点：{baseUrl}</div> : <div className="hint">当前：官方端点</div>}
        </div>

        <div className="field">
          <label>限额（防跑飞）</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><div className="hint" style={{ margin: 0 }}>任务时限（秒）</div><input className="inp" type="number" value={maxTaskSeconds} onChange={(e) => setMaxTaskSeconds(Number(e.target.value))} /></div>
            <div><div className="hint" style={{ margin: 0 }}>费用上限（USD）</div><input className="inp" type="number" step="0.1" value={maxCostUsd} onChange={(e) => setMaxCostUsd(Number(e.target.value))} /></div>
            <div><div className="hint" style={{ margin: 0 }}>最大并发子任务</div><input className="inp" type="number" value={maxConcurrency} onChange={(e) => setMaxConcurrency(Number(e.target.value))} /></div>
            <div><div className="hint" style={{ margin: 0 }}>卡住判定（秒）</div><input className="inp" type="number" value={stuckSeconds} onChange={(e) => setStuckSeconds(Number(e.target.value))} /></div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-sm" onClick={test} disabled={busy}>测试连接</button>
          <button className="btn primary" onClick={save} disabled={busy}>保存</button>
        </div>
        {msg && <div className="test-msg">{msg}</div>}
        <div className="hint" style={{ marginTop: 10 }}>API Key 只保存在本机 server/.data/settings.json，不会上传。</div>
      </div>
    </div>
  );
}