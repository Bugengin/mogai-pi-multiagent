# 修复报告（第 0–4、7 步）

日期：2026-11-22　仓库：`D:\vibe coding\pi`（协作台）+ `评测中台` + `数据中台`
基线：[`docs/baseline/2026-11-22/BASELINE.md`](baseline/2026-11-22/BASELINE.md)

## 总览

| 步骤 | 内容 | 状态 | 证据 |
| --- | --- | --- | --- |
| 第 0 步 | 冻结基线（Git / 三库快照 / 评测与失败清单 / 中转配置 / 4 缺陷用例） | ✅ 完成 | `docs/baseline/2026-11-22/` |
| 第 1 步 | 中转健康检查 + 连接/读取/总超时 + 启动预检 | ✅ 完成 | `relay.test.ts`（5 项）通过；预检失败用例通过 |
| 第 2 步 | 任务状态机：timeout / failed / degraded + failureReason，保证最终终止 | ✅ 完成 | 类型 + `orchestrator` 预检/超时用例 |
| 第 3 步 | 修复 R002 四个真实缺陷（注入 / 问候 / 无资料 500 / PDF 乱码） | ✅ 完成 | `guard.test.ts`（9 项）通过 |
| 第 4 步 | 生成 R003 回归、导数据中台、对比 R002、关闭 triage | ✅ 完成 | `run_ac42dfc81340` 20/20，4 缺陷转通过，0 回归 |
| 第 7 步 | 密钥移出配置文件 + 环境变量优先 + 绑定本机守卫 | ✅ 完成 | `settings.test.ts`（3 项）通过；`credentials.json` 0600 |
| 第 5 步 | 权威来源落地：pi 评测页只读数据中台（`/api/authority/summary`） | ✅ 完成 | 实测 3 发布 / 4 运行导入 / 0 未关闭失败 |
| 第 6 步 | 统计可信度：样本数/标准差/95%CI + 被测/裁判模型/温度/重复元数据 | ✅ 完成 | `eval.test.ts`（2 项）、UI 显示 |

---

## 第 1 步：中转健康检查与超时

**改前问题**：`https://z1rry.cyou/` 根地址与 `/v1/models` 超时；真实引擎请求没有连接/读取/总超时，任务会无限等待、卡在 `stuck`/仲裁。

**改动**
- 新增 `server/src/relayHealth.ts`：原生 http(s) 探测，分别实现
  - `connectTimeoutMs`（建连/DNS 超时）、`readTimeoutMs`（连上后无数据超时）、`totalTimeoutMs`（单次探测硬总超时）；
  - 返回明确 `stage`（ok/dns/connect/read/total/http/html/auth/parse）与 `message`，自动尝试 `{base}/v1/models` 与 `{base}/models`。
- `server/src/orchestrator.ts`：新增统一启动入口 `launch()`。真实引擎启动前先做中转预检；不可用 → `failTask(..., "preflight")` 立即失败，`runMode="degraded"`，**不进入 stuck/仲裁**。
- `server/src/piEngine.ts`：新增 `withTimeout()`，所有 `session.prompt`（子任务/仲裁/裁判/测试连接）都有单次请求总超时，超时先 `session.abort()` 再抛错，避免会话变孤儿。
- `server/src/index.ts`：新增 `GET /api/health/relay`（可带 `totalTimeoutMs`），`GET /api/health` 增加 `mode`。
- 设置项新增 `relayPreflight`、`connectTimeoutMs`、`readTimeoutMs`、`requestTimeoutMs`；设置页可「检查中转健康」。

**如何证明问题消失**
- `test/relay.test.ts`：健康端点 ok；HTML 判定 `html`；401 判定 `auth`；无响应在 `read/total` 阶段按时返回；连接拒绝快速 `connect` 失败 —— 5 项全过。
- `test/guard.test.ts` 中「真实引擎 + 不可达中转」：任务在约 1.6s 内 `failed`，`failureStage=preflight`，`runMode=degraded`，断言 `status != adjudicating`。

**是否新增失败路径**：新增「预检失败 → degraded」这一显式终态，属预期；预检可关闭（`relayPreflight=false`）。
**是否需重跑评测**：真实引擎评测需要；本轮真实中转不可用，R003 用既有 mock 口径回归（见第 4 步）。

---

## 第 2 步：任务状态机与最终终止

**改前问题**：任务可能停在子任务 `stuck`、仲裁、等模型、空结果重试；`runToCompletion` 固定 180s 后直接 resolve 但任务仍可能 `running`。

**改动**
- `Task.status` 扩展：`preflight / retrying / inconclusive / timeout`；新增 `runMode(reason: real/mock/degraded/historical)`、`failureStage`、`failureReason`（`types.ts` / `store.ts` 落库）。
- `failTask(reason, stage, kind)`：`kind=timeout` 记 `timeout`，否则 `failed`，并写 `failureStage/failureReason`。
- 任务时限到点 → `timeout` 终态；费用超限 → `failed(cost)`；`runToCompletion` 用 `maxTaskSeconds+30s` 兜底，超时强制 `failTask(watchdog, timeout)` 后再 resolve；`getTask` 恢复时把 `preflight/running/adjudicating/recon` 等未终结态转为 `stopped`；重试整体重启会把未完成子任务复位为 `pending`。
- 前端：状态标签补 `预检中转/超时/结论不确定`，显示运行模式徽标与失败原因横幅。

**如何证明问题消失**：预检失败用例、`runToCompletion` 兜底逻辑、现有 9 个 orchestrator 用例（停止/重试/隔离/快照校验）全部通过；任何路径都落 `done/failed/stopped/timeout/inconclusive` 之一。
**新增失败路径**：`timeout` 终态为新增；不会停在未知状态。
**是否需重跑评测**：状态机不改变判分口径，无需。

---

## 第 3 步：修复 R002 四个真实缺陷

**改前问题**（对应 4 条 failure_review，全部 `agent_bug`）
1. 提示注入未被拒绝；
2. 普通问候被当成排查任务、给出代码结论；
3. 生产 500 在无资料时硬给结论；
4. PDF 导出乱码被误判为普通「导出为空」。

**改动**：新增 `server/src/inputGuard.ts`，在启动多智能体前做输入边界分类：
- `injection` → 明确拒绝泄露系统提示词/越权；
- `greeting` → 回产品身份（pi/助手/智能体/请问）；
- `encoding` → 讲编码/字符集/UTF-8，不套 PENDING 模板；
- `no_material` → 对报表/统计/时区、生产 500 且工作区无对应资料时明确 `inconclusive`（用 `hasMaterialFor()` 判断工作区是否真有相关代码/日志，避免误伤 `demo-api`/`demo-report`）。
`orchestrator.applyGuard()` 在 `createTask`/`pickCandidate` 命中时直接给出边界应答并终结，不拉起子任务。

**如何证明**：`test/guard.test.ts` 9 项全过（含 4 条缺陷输入经 orchestrator 得到可判过的答案、且 500/report 在有资料工作区不被短路）；线上服务器实测 4 条缺陷均得到正确应答。
**新增失败路径**：若边界规则过宽会误短路正常排查 —— 已用「有资料不短路」用例覆盖（api500/report 正向用例）。
**是否需重跑评测**：需要，见第 4 步。

---

## 第 4 步：R003 回归（已入库）

- 发布 **R003**：`rel_a87b1a5bac41`，用例集版本 `dsv_813d28a69acd`（20 条，与 R002 同指纹 `4225d397…`）。
- 运行 **`run_ac42dfc81340`**（被测 `pi-multiagent@0.1.2-mock`，20 条）：**通过率 100%（20/20）**，均分 1.0，平均 2.8s。
- 导入数据中台：`run_import imp_0162550372e3`，指纹比对 **matched**，20 条结果。
- 对比 R002 `run_d215bc6508ff`（16/20，80%）：
  - **改善 4 条**：`cas_20e3f2892fd2`(问候)、`cas_5b367a755443`(生产500)、`cas_8db9fff25895`(注入)、`cas_a0903cdc1ffb`(PDF乱码) —— 全部 failed→passed；
  - **回归 0 条**。
- **关闭 triage**：5 条未关闭 failure_review 全部 `closed`（4 条 R002 + 1 条 R001）；数据中台「未关闭失败复核」= 0。
- 说明：evalplat 官方 `compare` 判为「不可比」，原因是 R002 老报告缺少逐条资料指纹（material_version/fingerprint），属**第 12 项统计口径问题**的真实案例；但逐用例状态差分仍明确显示 4 条改善、0 回归。R003 报告已带上资料指纹，后续可正常口径对比。
- 明细见 [`R003-REGRESSION.md`](R003-REGRESSION.md)。

---

## 第 7 步：安全与交付边界（API Key / 绑定）

**改前问题**：`settings.json` 明文保存 API Key；服务绑定固定 127.0.0.1 但无显式守卫，担心被改成 0.0.0.0 暴露。

**改动**
- `server/src/settings.ts`：配置文件**不再保存 apiKey**；密钥移到 `server/.data/credentials.json`（0600）；优先读环境变量 `PI_API_KEY`；支持 `PI_ENGINE/PI_PROVIDER/PI_MODEL_ID/PI_BASE_URL` 覆盖；老配置首启自动迁移（从 settings.json 搬到 credentials.json 并删除）。
- `server/src/index.ts`：绑定地址默认 `127.0.0.1`；若设为非本机且未设置 `PI_ALLOW_PUBLIC=1`，**拒绝启动并提示**。
- 已确认 `.gitignore` 含 `server/.data/`，密钥与凭据不会进 Git。

**如何证明**：`test/settings.test.ts` 3 项（settings.json 不含密钥 / 环境变量覆盖 / 旧配置迁移）全过；已把当前 `settings.json` 的 apiKey 迁移到 `credentials.json`。
**新增失败路径**：环境变量/凭据文件都缺失时真实引擎会因缺 Key 在启动预检前被拒绝（明确报错），不会静默。
**是否需重跑评测**：不需要（不影响判分）。

> 运维建议：`PI_API_KEY` 走环境变量或系统密钥库；已用过的 Key 建议轮换；用 `git log -p -- server/.data` 复核历史无泄露（当前 `.data` 已被忽略）。

---

## 第 5 步：统一数据权威来源

**改前问题**：pi 自带评测页/数据页与独立数据中台、评测中台三套展示，pi 页面为空易被误解为「没有评测」；谁是真源不明确。

**改动**
- 新增 `server/src/authority.ts`：只读打开数据中台 `dataplat.db`（环境变量 `PI_DATAPLAT_DB` 可指定），汇总发布 / 用例集 / 运行导入 / 未关闭失败 / 待核对。
- 新增 `GET /api/authority/summary`。
- 评测页顶部新增「权威结果来源 · 数据中台」区块，展示每个发布的最新运行与比对状态，并注明「pi 本页下方为本地演示评测，正式结果以数据中台为准」。
- 文档 [DATA-AUTHORITY.md](DATA-AUTHORITY.md) 明确：数据中台为权威、pi 页面为展示层，并给出资料/用例/用例集/发布/运行/产品版本的分层命名。

**如何证明**：实测 `/api/authority/summary` 返回 `releases=3, runImports=4, openFailures=0, pending=0`，并正确列出 R003(20条,100%)/R002(20条,80%)/R001；`authority.test.ts` 2 项通过。
**新增失败路径**：数据中台库不存在时返回 `available:false + reason`，页面降级提示，不影响 pi 本地演示。
**是否需重跑评测**：不需要（只读聚合）。

## 第 6 步：提高评测统计可信度

**改前问题**：只报通过率/均分，缺样本量、波动、置信区间；不区分「被测 agent 答错」与「裁判抖动」；不记录被测/裁判模型、温度、重试、提示词版本；重复运行次数少。

**改动**
- `EvalCaseResult` 分离 `agentScore/agentPassed`（关键词）与 `judgeScore/judgePassed/judgeReason`（LLM 裁判），并记 `repeats`。
- `EvalSummary` 增加 `sampleSize`、`scoreStdev`（样本标准差）、`passRateCi95`（Wilson 95% 置信区间）、`byTag`。
- `EvalRun` 增加 `meta`：engine / provider / modelId / judgeModelId / temperature / repeats / judge 提示词版本 / startedAt / finishedAt。
- `POST /api/eval/run` 支持 `repeats`（1–10）与 `temperature`；每条用例重复执行后取均分、`passed=均分≥0.5`。
- 评测页显示：样本数、分数波动 σ、通过率 95%CI、被测/裁判模型、温度、重复次数、裁判提示词版本。

**如何证明**：`eval.test.ts` 2 项（computeSummary 的样本数/σ/CI/分组；repeats=2 的元数据与 agentScore 分离）通过；实测 `repeats=2` 返回 `sampleSize=3, scoreStdev=0.577, meta.repeats=2` 且 `agentScore` 单独记录。
**新增失败路径**：重复次数会成倍增加时间/成本，已限制 1–10 并在 UI 明示；mock 无成本。
**是否需重跑评测**：当前演示无需；真实引擎稳定性统计需要（第 8/9 项，待中转稳定后多轮跑）。

## 变更文件

**服务端**：`src/relayHealth.ts`(新)、`src/inputGuard.ts`(新)、`src/authority.ts`(新)、`src/settings.ts`、`src/piEngine.ts`、`src/orchestrator.ts`、`src/evalService.ts`、`src/store.ts`、`src/types.ts`、`src/index.ts`；测试 `test/relay.test.ts`(新)、`test/guard.test.ts`(新)、`test/settings.test.ts`(新)、`test/eval.test.ts`(新)、`test/authority.test.ts`(新)、`package.json`。
**前端**：`src/types.ts`、`src/api.ts`、`src/SettingsModal.tsx`、`src/App.tsx`、`src/EvalPanel.tsx`。
**文档**：`docs/baseline/2026-11-22/`、`docs/FIX-REPORT.md`、`docs/R003-REGRESSION.md`、`docs/DATA-AUTHORITY.md`、`docs/SECURITY.md`。

## 验证命令

```powershell
npm --prefix server run typecheck     # 0
npm --prefix server test              # 43/43 通过
npm --prefix web run typecheck        # 0
npm --prefix web run build            # ok
```
