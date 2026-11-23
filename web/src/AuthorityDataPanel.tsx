import { useEffect, useState } from "react";
import { getAuthorityMaterials, getAuthorityCases, getAuthorityReleases, getAuthorityDataset } from "./api";
import type { AuthorityMaterialsResult, AuthorityCasesResult, AuthorityReleasesResult, AuthorityDatasetResult } from "./api";

export default function AuthorityDataPanel() {
  const [materials, setMaterials] = useState<AuthorityMaterialsResult | null>(null);
  const [cases, setCases] = useState<AuthorityCasesResult | null>(null);
  const [releases, setReleases] = useState<AuthorityReleasesResult | null>(null);
  const [ds, setDs] = useState<AuthorityDatasetResult | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setMaterials(await getAuthorityMaterials());
        setCases(await getAuthorityCases());
        setReleases(await getAuthorityReleases());
      } catch (e) {
        setMsg(String(e));
      }
    })();
  }, []);

  const available = !!materials?.available;

  async function openDataset(id: string) {
    if (!id) return;
    setDs(await getAuthorityDataset(id));
  }

  return (
    <div className="eval" style={{ marginBottom: 15 }}>
      <div className="eval-head">
        <div>
          <h2>数据 · 权威来源</h2>
          <div className="muted">资料 / 用例 / 发布 / 用例集均为**只读**，来自数据中台 dataplat.db；pi 页面不修改权威数据。</div>
        </div>
        <span className={"tagres " + (available ? "pass" : "fail")}>
          {available ? "数据来源：数据中台（权威）" : "数据中台未连接"}
        </span>
      </div>

      {msg && <div className="test-msg">{msg}</div>}

      {!available && (
        <div className="eval-card">
          <div className="muted">{materials?.reason || "未找到数据中台库（可用 PI_DATAPLAT_DB 指定）"}</div>
        </div>
      )}

      {available && (
        <>
          <div className="eval-card">
            <div className="section-label">资料（{materials?.materials.length || 0}）· 版本与内容指纹</div>
            <table className="eval-table">
              <thead><tr><th>标题</th><th>版本</th><th>最新内容哈希</th><th>来源</th></tr></thead>
              <tbody>
                {(materials?.materials || []).map((m) => {
                  const v = m.versions[0];
                  return (
                    <tr key={m.id}>
                      <td className="cell-goal">{m.title}</td>
                      <td>{m.versions.length} 版{v ? "（最新 " + v.id + "）" : ""}</td>
                      <td className="cell-hash">{v ? v.contentSha256.slice(0, 12) : "-"}</td>
                      <td>{m.sourceRef || m.originalFilename || "-"}</td>
                    </tr>
                  );
                })}
                {(!materials || materials.materials.length === 0) && <tr><td colSpan={4} className="muted">无资料</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="eval-card">
            <div className="section-label">用例（{cases?.cases.length || 0}）· 用例版本</div>
            <table className="eval-table">
              <thead><tr><th>用例</th><th>当前版本</th><th>状态</th><th>标签</th></tr></thead>
              <tbody>
                {(cases?.cases || []).map((c) => {
                  const v = c.versions.find((x) => x.id === c.currentVersionId) || c.versions[0];
                  return (
                    <tr key={c.id}>
                      <td className="cell-goal">{c.title || c.id}</td>
                      <td>{v ? v.id + "（v" + v.versionNo + "）" : "-"}</td>
                      <td>{v ? <span className={"tagres " + (v.status === "published" ? "pass" : "fail")}>{v.status}</span> : "-"}</td>
                      <td>{(v?.tags || []).join("、")}</td>
                    </tr>
                  );
                })}
                {(!cases || cases.cases.length === 0) && <tr><td colSpan={4} className="muted">无用例</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="eval-card">
            <div className="section-label">发布记录（{releases?.releases.length || 0}）· 资料与用例集关联</div>
            <table className="eval-table">
              <thead><tr><th>发布</th><th>用例集版本</th><th>用例数</th><th>用例集指纹</th><th>发布时间</th><th></th></tr></thead>
              <tbody>
                {(releases?.releases || []).map((r) => (
                  <tr key={r.id}>
                    <td>{r.releaseNo}</td>
                    <td>{r.datasetVersionId}</td>
                    <td>{r.caseCount}</td>
                    <td className="cell-hash">{r.fingerprint.slice(0, 12)}</td>
                    <td>{r.publishedAt}</td>
                    <td><button className="btn-sm" onClick={() => openDataset(r.datasetVersionId)}>看用例集</button></td>
                  </tr>
                ))}
                {(!releases || releases.releases.length === 0) && <tr><td colSpan={6} className="muted">无发布</td></tr>}
              </tbody>
            </table>
            {ds && ds.available && ds.version && (
              <div style={{ marginTop: 10 }}>
                <div className="section-label">
                  {ds.dataset?.name || ds.version.id} · v{ds.version.versionNo}（{ds.items.length} 条，指纹 {ds.version.fingerprint.slice(0, 12)}）
                </div>
                <table className="eval-table">
                  <thead><tr><th>#</th><th>用例</th><th>用例版本</th><th>状态</th><th>标签</th></tr></thead>
                  <tbody>
                    {ds.items.map((it) => (
                      <tr key={it.caseVersionId + "-" + it.seq}>
                        <td>{it.seq}</td>
                        <td className="cell-goal">{it.title || it.caseId}</td>
                        <td>{it.caseVersionId}（v{it.versionNo}）</td>
                        <td>{it.status}</td>
                        <td>{it.tags.join("、")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ds && !ds.available && <div className="muted" style={{ marginTop: 8 }}>{ds.reason}</div>}
          </div>
        </>
      )}
    </div>
  );
}
