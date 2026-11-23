# R004 真实引擎评测报告（0.1.2-real）

日期：2026-11-22　运行：`run_2263d1062f41`　被测：`pi-multiagent@0.1.2-real`　基线：R003（mock）

## 结论

- 20 条用例：**11 通过 / 9 失败 / 0 错误**，通过率 **55.0%**，平均分 **0.8583**，平均耗时 **27606 ms / 条**，总成本 **$0.862**。
- 与 R003 mock 的 **20/20（100%）** 相比，真实模型暴露出 mock 模板掩盖的能力差距；失败集中在 `key_points` 算子（11 条应用仅 2 条通过）。
- 9 条失败均为**模型作答未命中评分要点**（agent 能力差异），**没有中转/超时/费用类基础设施失败**（errored=0）。
- 4 条缺陷/安全用例（问候、注入、PDF 乱码、生产 500 无资料）全部通过。

## 运行参数（固定）

| 项 | 值 |
| --- | --- |
| 运行模式 | real（真实模型） |
| provider / modelId | deepseek / deepseek-v4.1-flash-1017 |
| baseUrl | https://z1rry.cyou/（中转） |
| 用例集 | dsv_813d28a69acd（指纹 `4225d397509bf387…`） |
| 资料版本 | mver_7a77712dd5e4（快照指纹 `39e2d993…`） |
| 评分算子 | always, contains_all, contains_any, exact_match, field_equals, json_schema, key_points, length_between, list_length, not_contains, not_empty, numeric_approx, regex, rubric, subset |
| repeats | 1（evalplat run 单轮；多轮稳定性见第 6 轮） |
| 成本 | 总 $0.862；单条均值 $0.043 |

## 失败用例（9 条，均为能力差异）

| 用例 | 问题 | 分数 | 模型根因（摘要） |
| --- | --- | --- | --- |
| cas_37305da3201c | 如何验证导出为空不是写入层的问题？ | 0.67 | 导出为空的原因是查询层返回 0 行：queryBuilder.ts:120 处的唯一行级过滤条件 status='PENDING' 把记录全 |
| cas_4766d39f0d5d | src/core.ts 第 64 行是什么 edge case？ | 0.67 | src/core.ts:64 本身没有任何可执行逻辑，只有一条占位注释「// edge case not handled」；实质根因是 qu |
| cas_4c125249d7e8 | 复现用例 edge-case-17 说明什么问题？ | 0.67 | 导出链路缺少对 null/undefined 入参的空值判断（src/core.ts:64 自称「edge case not handled |
| cas_60553c6453b8 | 帮我确认 fallback path 是不是问题来源 | 0.67 | fallback path 是问题来源：writer.ts:42 仅以 rows.length===0 判定，将上游异常/空输入（src/c |
| cas_963883dcb06e | 导出接口返回空数组是什么原因？ | 0.67 | queryBuilder.ts:120 硬编码附加的 .where("status","PENDING") 过滤条件使查询命中 0 行；ro |
| cas_b5cf48dfcd20 | 为什么导出的文件只有表头？ | 0.67 | 导出只写表头的实质根因是查询结果为空（rows=0）：queryBuilder 中硬编码的 .where("status","PENDING |
| cas_b89a9bc11ffd | 导出文件为空但数据库有数据，为什么？ | 0.67 | （空结论） |
| cas_bf6b5a2907fe | 导出文件为空是怎么回事？ | 0.83 | queryBuilder.ts:120 把 status 硬编码成 'PENDING'，使查询结果被限制为 0 行；当 rows=0 时，w |
| cas_dde042d4a876 | 导出为空是查询还是写入的问题？ | 0.67 | 查询侧根因：该次导出的查询返回 rows=0，写入层按设计仅写表头（header-only），故空文件并非写入丢数据；导致 0 行最可能的实 |

## 分类与导入

- 失败类型：全部 `agent`（key_points 未命中）；`relay/timeout/cost = 0`。
- 发布：R004 `rel_78123afb9a30`，用例集 `dsv_9d488338e409`（指纹与 R003 一致）。
- 导入数据中台：`imp_22eda62c42e9`，`match_status = matched`，20 条结果，新增 9 条失败复核。

## 已知限制

- 本轮 `repeats=1`；多轮重复与稳定性看板留待第 6 轮。
- evalplat 命令适配器此前只读 `usage.tokens`，导致本报告 `tokens_out` 为空；已修 `pi_subject.mjs` 同时输出 `usage`，下次运行可记录 token。成本已完整记录。
- 报告通过「等价数据集重标注」归入 R004（R004 与 R003 用例内容/指纹相同、case_version 相同），未改动任何用例结果。
