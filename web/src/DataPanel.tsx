import { useEffect, useState } from "react";
import { getDocuments, importDocument, getDocument, getVersionContent, addDocVersion, deleteDocument } from "./api";
import type { DocSummary, DocDetail } from "./api";
import AuthorityDataPanel from "./AuthorityDataPanel";

export default function DataPanel() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [selected, setSelected] = useState<DocDetail | null>(null);
  const [preview, setPreview] = useState<{ version: number; content: string; contentHash: string } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [newVersionContent, setNewVersionContent] = useState("");
  const [showAddVersion, setShowAddVersion] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    try { setDocs(await getDocuments()); } catch { /* ignore */ }
  }
  useEffect(() => { load(); }, []);

  async function openDoc(id: string) {
    const d = await getDocument(id);
    setSelected(d);
    setPreview(null);
    setShowAddVersion(false);
    setNewVersionContent("");
  }

  async function doImport() {
    if (!name.trim() || !content.trim()) { setMsg("名称和正文必填"); return; }
    const r = await importDocument({ name, source, content, note });
    setMsg(r.unchanged ? ("内容无变化，沿用 v" + r.version) : ("已导入 v" + r.version));
    setName(""); setSource(""); setContent(""); setNote(""); setShowImport(false);
    await load();
    await openDoc(r.documentId);
  }

  async function viewVersion(v: number) {
    if (!selected) return;
    const r = await getVersionContent(selected.document.id, v);
    setPreview({ version: v, content: r.content, contentHash: r.contentHash });
  }

  async function doAddVersion() {
    if (!selected || !newVersionContent.trim()) { setMsg("新版本正文必填"); return; }
    const r = await addDocVersion(selected.document.id, newVersionContent, note);
    setMsg(r.unchanged ? ("内容无变化，仍是 v" + r.version) : ("已新增 v" + r.version));
    setNewVersionContent(""); setShowAddVersion(false);
    await load();
    await openDoc(selected.document.id);
  }

  async function doDelete(id: string) {
    if (!window.confirm("确定删除这份资料及其所有版本？")) return;
    await deleteDocument(id);
    if (selected && selected.document.id === id) { setSelected(null); setPreview(null); }
    await load();
  }

  return (
    <div className="eval">
      <AuthorityDataPanel />

      <div className="eval-head">
        <div>
          <h2>本地演示资料 · 资料版本库</h2>
          <div className="muted">数据来源：pi 本地演示缓存（非权威）。导入业务原文即生成快照；同来源内容不变不重复入库，修订自动升版本，旧版本永久保留可回溯。</div>
        </div>
        <button className="btn primary" onClick={() => setShowImport((v) => !v)}>{showImport ? "收起" : "导入资料"}</button>
      </div>

      {msg && <div className="test-msg" style={{ marginBottom: 14 }}>{msg}</div>}

      {showImport && (
        <div className="eval-card">
          <div className="section-label">导入资料</div>
          <div className="dfield"><label>名称</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：内部报销制度" /></div>
          <div className="dfield"><label>来源（选填）</label><input className="inp" value={source} onChange={(e) => setSource(e.target.value)} placeholder="如：财务部-2026版.pdf" /></div>
          <div className="dfield"><label>正文</label><textarea className="inp" rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="粘贴原文（Markdown / 纯文本）" /></div>
          <div className="dfield"><label>备注（选填）</label><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="版本说明" /></div>
          <div className="modal-actions"><button className="btn primary" onClick={doImport}>导入</button></div>
        </div>
      )}

      <div className="eval-card">
        <div className="section-label">资料列表（{docs.length}）</div>
        <table className="eval-table">
          <thead><tr><th>名称</th><th>来源</th><th>版本</th><th>最近更新</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="cell-goal">{d.name}</td>
                <td>{d.source || "-"}</td>
                <td>v{d.latestVersion}（{d.versions} 版）</td>
                <td>{new Date(d.updatedAt).toLocaleString()}</td>
                <td>
                  <button className="btn-sm" onClick={() => openDoc(d.id)}>查看</button>{" "}
                  <button className="btn-sm" onClick={() => doDelete(d.id)}>删除</button>
                </td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td colSpan={5} className="muted">还没有资料，点右上角「导入资料」</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="eval-card">
          <div className="section-label">{selected.document.name} · 版本历史</div>
          <table className="eval-table">
            <thead><tr><th>版本</th><th>字数</th><th>内容哈希</th><th>备注</th><th>时间</th><th></th></tr></thead>
            <tbody>
              {selected.versions.map((v) => (
                <tr key={v.version}>
                  <td>v{v.version}</td>
                  <td>{v.chars}</td>
                  <td className="cell-hash">{v.contentHash.slice(0, 12)}</td>
                  <td>{v.note || "-"}</td>
                  <td>{new Date(v.createdAt).toLocaleString()}</td>
                  <td><button className="btn-sm" onClick={() => viewVersion(v.version)}>查看快照</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button className="btn-sm" onClick={() => setShowAddVersion((v) => !v)}>{showAddVersion ? "收起" : "加新版本"}</button>
          </div>
          {showAddVersion && (
            <div style={{ marginTop: 10 }}>
              <textarea className="inp" rows={5} value={newVersionContent} onChange={(e) => setNewVersionContent(e.target.value)} placeholder="粘贴修订后的完整正文（相同内容不会生成新版本）" />
              <div className="modal-actions" style={{ marginTop: 8 }}><button className="btn primary" onClick={doAddVersion}>保存为新版本</button></div>
            </div>
          )}
          {preview && (
            <div style={{ marginTop: 14 }}>
              <div className="section-label">v{preview.version} 快照（哈希 {preview.contentHash.slice(0, 12)}）</div>
              <pre className="doc-preview">{preview.content}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
