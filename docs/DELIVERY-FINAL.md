# 最终交付说明（R004 数据治理收尾）

日期：2026-11-22　范围：pi 多智能体排查台 + 评测中台/数据中台联动
状态：核心功能、评测链路与稳定性看板已完成；本轮完成 P0/P1 收尾（失败 triage 闭环、失败分类透传、报告元数据完整化、导入 run_id 存在性校验、语义评分、空结论重试指标、失败分类修正）。剩余 P2 明确列为已知限制。

> **范围定位（2026-11-23 确认）**：本项目面向**个人本地、单用户、非公网**使用。登录/权限/多租户、生产数据库、公网部署与反向代理、高可用中转、Secret Manager、生产级备份恢复、长期监控运维等生产化事项**均不在范围内**。个人本地场景下核心功能已完成，剩余事项均为历史复现、统计增强与模型能力优化，无必须解决的核心阻塞。详见 [SCOPE-FINAL.md](SCOPE-FINAL.md)。

## 一、总览

| 维度 | 结果 |
| --- | --- |
| 评测执行库 | D:\vibe coding\评测中台\eval-platform\evalplat.db（26 条 run，含 R003 / R002-repro / R004 三轮真实） |
| 数据权威库 | D:\vibe coding\数据中台\db\dataplat.db（R001–R004 四次发布，5 次 run_import 全部 matched，待核对 0，未关闭失败复核 0） |
| R003（mock） | 20/20，均分 1.0 |
| R004 正式基线 run_2263d1062f41 | 字面评分 11/20（55%）；语义评分复评 19/20（95%）；仅 1 条真实空结论（accepted_limitation） |
| R004 三轮聚合 | 原始口径 32/60（53.3%，含评分器同义词误差）；轮次角色：baseline + 2 stability_round |
| 测试 | server 66/66；evalplat 188/188；dataplat 16/16；web 构建通过 |

> **评分口径强调**：**55% = 原始模型运行（run_2263d1062f41）的字面评分（11/20）**；**95% = 同一批输出的语义评分复评（19/20，复用已有输出、未重新调用模型）**。不得把 95% 表述为真实模型重新运行的准确率。

## 二、本轮完成的收尾项（P0 / P1）

| 事项 | 状态 | 证据 |
| --- | --- | --- |
| R004 9 条失败复核 triage | ✅ 已闭环 | 8 条 judge_failure 已 closed、1 条 inconclusive 标记 accepted_limitation；未关闭失败复核 = 0。见 数据中台/docs/R004-FAILURE-TRIAGE.md |
| 失败分类透传到数据中台 | ✅ | evalplat 新增 failure.py 分类并在报告 subject.meta/output 落 failureCategory；dataplat 导入按 agent→agent_bug、relay→relay_failure、timeout→timeout、cost→cost_failure、judge→judge_failure、guard→guarded、inconclusive→inconclusive、parse→parse_failure 映射；test_failure_category 覆盖 |
| 单轮报告元数据完整化 | ✅（第一轮 token 例外） | R004 各轮报告 meta 增加 engine/provider/modelId/temperature/repeats/aggregation/promptVersions/totalTokens/totalCostUsd/startedAt/finishedAt；生成 R004-complete.json（token 完整轮，avg_tokens_out 73,371.65，总 token 1,467,433，逐条可核对） |
| 导入前 run_id 存在性校验 | ✅ | import-run 新增 --eval-db 校验 evalplat.db 的 runs；不存在则进 pending_report 原因 eval_run_not_found，不进正式指标/复核；--allow-external-run 显式放行 |
| R004 三轮正式/稳定性口径 | ✅ | run_2263d1062f41 为正式基线（已入数据中台）；run_a54d567ef655 / run_182b12eeacbe 标记 stability_round，仅稳定性看板。见 数据中台/docs/R004-SCOPE.md |
| key_points 同义词/语义评分 | ✅ | 算子同时输出 literalScore / semanticScore / finalScore 并内置同义词组（边界、0 行、空表头、不是写入、status=PENDING）；R004 基线复评 0.55→0.95 |
| 空结论重试恢复统计 | ✅ | 新增 initialEmptyCount / retryCount / retryRecoveredCount / finalEmptyCount / retryRecoveryRate 与重试额外成本/耗时（估算）；旧数据降级为 0 |
| 失败分类口径修正 | ✅ | 成本失败独立为 cost_failure；基础设施失败率含 relay_failure/timeout/cost_failure/parse_failure，不含 agent_bug/guarded/inconclusive/judge_failure |

## 三、已知限制 / 剩余 P2

1. R002-repro 是协议归一化基线：复用旧 R002 输出 + 当前算子重判 + 资料指纹回填，不是模型重新执行结果。真实历史重跑需旧产品代码、旧模型配置与同一资料快照。
2. repeats 口径：R004 每轮内部 repeats=1，稳定性来自 3 次独立 evalplat run。单条用例 repeats=3 已于 2026-11-23 补充执行（4 条代表用例 12 次尝试全部通过、0 翻转、0 空结论，见 [REPEATS3.md](REPEATS3.md)）；全量 20 条仍以三轮独立运行为准。
3. R004 第一轮历史 token 无法回溯（适配器修复前未采集）；R004-complete.json 以第二轮 run_a54d567ef655 作为 token 完整自包含代表，正式基线仍为 run_2263d1062f41。
4. round2 / round3 仅用于稳定性看板，不进入数据中台正式发布指标（按口径有意为之）。
5. 语义评分与空结论重试指标对历史已生成报告需重跑或离线复评才反映；本次 R004 为离线语义复评。

> 以上 P2 在个人本地范围内**均非阻塞**；逐项状态、类型与处理建议见 [SCOPE-FINAL.md](SCOPE-FINAL.md)。

## 四、验证命令

poweshell：

1) pi：npm --prefix server run typecheck；npm --prefix server test；npm --prefix web run build
2) 评测中台（eval-platform 目录）：python -m pytest -q
3) 数据中台（数据中台目录）：python -m dataplat --root . status（期望 5 次导入 matched、待核对 0、未关闭失败复核 0）

## 五、主要产物

- 代码：server/src/stability.ts、evalService.ts；evalplat/evalplat/failure.py、runner.py、storage.py、operators/builtin.py；dataplat/dataplat/cli.py、db/schema.sql
- 报告：数据中台/samples/pi-demo/reports_r004/R004-complete.json；R004 各轮报告 meta 已补全
- 文档：docs/R004-FAILURE-TRIAGE.md、docs/R004-SCOPE.md（数据中台）；docs/DELIVERY-FINAL.md、docs/STABILITY-R004.md、docs/R003-REGRESSION.md（pi）
