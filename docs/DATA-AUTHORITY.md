# 数据权威来源与版本口径（第 5/6/11/12/13 项）

日期：2026-11-22　状态：**决策已定，部分待落地**

## 1. 结论：谁说了算

**独立数据中台（数据中台/db/dataplat.db）是唯一权威事实来源。**
pi 自带的「评测页 / 数据页」只是**展示层/本地缓存**，不作为事实来源。

| 位置 | 定位 | 是否权威 |
| --- | --- | --- |
| 数据中台 `dataplat.db`（release / dataset_version / run_import / failure_review） | 发布、用例集版本、运行导入、失败复核的**权威库** | ✅ 是 |
| 评测中台 `evalplat.db`（runs / case_results） | 运行明细与评分的**权威执行库**，权威报告经 export/import 进入数据中台 | ✅ 是（运行层） |
| pi 自带评测页（`server/.data/eval_runs.json`） | 本地演示缓存，易与正式结果混淆 | ❌ 否（仅演示） |
| pi 数据页 · 权威来源区（`/api/authority/*` 只读 dataplat.db） | 资料/用例/发布/用例集只读展示 | ✅ 是（只读代理） |
| pi 数据页 · 本地演示区（`server/.data/pi.db` documents） | 本地资料库演示，已标注「非权威」 | ❌ 否（仅演示） |
| pi 页面为空 | **正常**：pi 页面只显示本进程/本机的演示数据，不代表正式结果为空 | — |

> 正式结果一直在 `dataplat.db` 与 `evalplat.db`；pi 页面为空不代表没有评测过。

## 2. 版本 / 发布 / 用例集 命名层级（第 13 项）

必须逐层区分，避免「R001 既像发布又像基线」「0.1.0-mock 既像产品版本又像评测版本」：

| 层级 | 命名示例 | 说明 | 存在位置 |
| --- | --- | --- | --- |
| 资料版本 | `mver_7a77712dd5e4` | 某份资料快照的版本 | material_version |
| 用例版本 | `cver_2c171be197df` | 单条用例的版本（input/expected/tags） | case_version |
| 用例集版本 | `dsv_46f1ae2731b2` | 一批用例冻结后的版本，带指纹 | dataset_version |
| 发布编号 | `R001 / R002 / R003` | 一次「资料+用例集+Agent」的发布 | release |
| 评测运行编号 | `run_ac42dfc81340` | evalplat 一次执行 | runs / run_import |
| 产品版本 | `0.1.2-mock` | Agent 自身版本（可对比） | agent.version |

旧口径问题解释：
- R001 出现过 `0.1.0-mock` 与 `0.1.1-mock`` 两次导入 —— 同一个「发布编号」下跑了两个**产品版本**（修复前后），需看 run_import.subject_version 区分；
- R002 用 20 条、数据中台 23 条 —— 23 是全部用例，R002 是其中冻结的 20 条子集（另有 3 条属 R001）；应对照 dataset_item，而不是用 23 报通过率；
- 21 次运行、9 次 pi 运行、3 个用例集 —— evalplat 全库 21 条 run 里只有 9 条是 pi-multiagent；统计时必须先按 subject 过滤，再按 release 归组；
- 65% 类指标需明确口径：**按用例（case）加权**为准，报告同时给 total；按 run 平均仅作辅助；
- 成本是否含重试和裁判：**应含**，由 subject/评测端 usage 汇总；当前 mock 为 0，真实引擎需把裁判 token 单独记。

## 3. 同步设计（建议落地）

- 评测中台 → 数据中台：只用 ` evalplat export --format json ` 报告，经 ` dataplat import-run ` 入库（幂等，按 run_id/report_sha256 去重）；
- 发布时冻结：` dataplat release ` 生成 manifest（release_id ↔ dataset_version ↔ material_fingerprint），报告必须带同指纹才 matched，否则进 pending 待核对，**不计入正式指标**；
- pi 自带页面：要么去掉「评测/数据」页的独立结果，要么改为只读代理到数据中台接口，避免两套互相独立的展示结果长期并存。

## 4. 验收口径（第 12 项）

每次对外给数必须同时给出：样本数 total、通过数 passed、通过率（按用例）、均分、平均耗时、成本口径（是否含裁判/重试）、被测产品版本、用例集版本指纹、资料版本。只报百分比不给样本数视为不合格。

## 5. 当前进展

- ✅ 已完成：R003 发布 + 运行导入 + 与 R002 的逐用例对比 + 关闭全部 5 条 triage（详见 R003-REGRESSION.md）；
- ✅ 已完成：pi 评测页新增「权威结果来源 · 数据中台」，通过 `GET /api/authority/summary` **只读**数据中台，展示发布 / 运行导入 / 未关闭失败 / 待核对；实测 `releases=3, runImports=4, openFailures=0, pending=0`；
- ✅ 已完成：统计口径元数据（样本数 / σ / 95%CI / 被测与裁判模型 / 温度 / 重复次数），见 FIX-REPORT 第 6 步；
- ✅ 已完成（第 2 轮 · 数据一致性）：新增 `evalplat import` 子命令，把 `run_ac42dfc81340` 标准报告导入评测中台主库 `eval-platform/evalplat.db`（保留原 run_id，不复制 SQLite 文件）；`python -m evalplat runs/show run_ac42dfc81340` 默认库即可查到；
- ✅ 已完成（第 2 轮）：生成可比较基线 `R002-repro`（R002 原始被测输出 + 当前统一算子重判 + 从 R002 快照重算逐条资料指纹），官方 `compare R002-repro → R003` 返回「改善：4 改善 / 0 回归 / 16 保持」，且用例集/算子指纹一致、判定可比；
- ✅ 已完成（第 2 轮）：CLI 输出「当前数据库」，pi 评测页分别显示「数据权威库」与「评测执行库」两条路径，避免两个库混淆；
- ✅ 已完成（第 5 轮 · 权威数据页）：pi 数据页顶部新增「数据 · 权威来源」，默认只读展示数据中台的资料（含版本与内容指纹）、用例（含用例版本/标签）、发布记录、用例集明细；下方本地 `server/.data/pi.db` 明确标注「本地演示资料（非权威）」；
- ✅ 已完成（第 5 轮）：新增只读接口 `GET /api/authority/materials`、`/materials/:id`、`/cases`、`/releases`、`/datasets/:id`，统一走 `PI_DATAPLAT_DB`，库缺失时返回 `available:false` + 原因，pi 页面不提供任何写操作；
- ✅ 已完成（第 4 轮 · 真实引擎首跑）：中转可用，真实模型（deepseek/deepseek-v4.1-flash-1017）跑通 R004 20 条，11 通过 / 9 失败 / 0 基础设施错误，通过率 55%、均分 0.858、成本 $0.862；报告 `run_2263d1062f41` 已导入数据中台 `match_status=matched`（详见 R004-REAL.md），与 R003 mock 分开统计；
- ✅ 已完成（第 6 轮 · 多轮稳定性）：真实引擎累计 3 轮（run_2263d1062f41 / run_a54d567ef655 / run_182b12eeacbe），32/60 通过（53.3%，95%CI 40.9~65.4%），均分 0.861，翻转率 15%，基础设施失败率 0%，P95 54.7s，单条成本 $0.043；看板 `/api/eval/stability` + pi 评测页「真实引擎稳定性」分区，失败类型分组展示；报告见 STABILITY-R004.md；
- 待落地：R004 后续轮次的逐条 token 字段补齐（适配器已修，下一轮生效）。
