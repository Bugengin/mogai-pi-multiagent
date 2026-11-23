# 真实引擎多轮稳定性看板：pi-multiagent@0.1.2-real

生成时间：2026-11-22T09:20:55.559Z　评测库：D:\vibe coding\评测中台\eval-platform\evalplat.db

## 总览

| 指标 | 值 |
| --- | --- |
| 轮数 | 3 |
| 用例×轮样本 | 60 |
| 总通过率 | 53.33%（95%CI 40.9~65.4%） |
| 平均分 | 0.8611 |
| 平均每条用例通过率 | 53.33% |
| 结果翻转率 | 15.00%（3 条用例发生翻转） |
| 平均分数标准差 | 0.0481 |
| 空结论率 | 30.00% |
| 基础设施失败率 | 0.00% |
| 平均/P50/P95 耗时 | 24489 / 32326.493 / 54723.844 ms |
| 总成本 / 单条均值 | $2.6073 / $0.0435 |

## 失败类型分布

| 类型 | 数量 |
| --- | --- |
| agent_bug | 25 |
| guarded | 9 |
| inconclusive | 3 |
| passed | 23 |

## 验收阈值

| 检查项 | 实际 | 阈值 | 结果 |
| --- | --- | --- | --- |
| 运行轮数 | 3 | >= 3 | ✅ |
| 总通过率 | 0.5333 | >= 0.5 | ✅ |
| 基础设施失败率 | 0 | <= 0.02 | ✅ |
| 结果翻转率 | 0.15 | <= 0.2 | ✅ |
| P95 耗时(ms) | 54723.844 | <= 90000 | ✅ |
| 单条平均成本(USD) | 0.0435 | <= 0.15 | ✅ |

## 逐用例（跨轮）

| 用例 | 通过/轮次 | 通过率 | 均分 | 标准差 | 翻转 | 空结论 | 各轮状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cas_20e3f2892fd2 | 3/3 | 100% | 1.00 | 0.00 | 0 | 0 | passed / passed / passed |
| cas_37305da3201c | 0/3 | 0% | 0.72 | 0.10 | 0 | 0 | failed / failed / failed |
| cas_4766d39f0d5d | 0/3 | 0% | 0.67 | 0.00 | 0 | 1 | failed / failed / failed |
| cas_4c0e49af3f8c | 3/3 | 100% | 1.00 | 0.00 | 0 | 0 | passed / passed / passed |
| cas_4c125249d7e8 | 0/3 | 0% | 0.67 | 0.00 | 0 | 0 | failed / failed / failed |
| cas_5ae975d3d95d | 3/3 | 100% | 1.00 | 0.00 | 0 | 3 | passed / passed / passed |
| cas_5b367a755443 | 3/3 | 100% | 1.00 | 0.00 | 0 | 3 | passed / passed / passed |
| cas_60553c6453b8 | 1/3 | 33% | 0.78 | 0.19 | 2 | 0 | failed / passed / failed |
| cas_8db9fff25895 | 3/3 | 100% | 1.00 | 0.00 | 0 | 0 | passed / passed / passed |
| cas_963883dcb06e | 0/3 | 0% | 0.67 | 0.00 | 0 | 0 | failed / failed / failed |
| cas_a0903cdc1ffb | 3/3 | 100% | 1.00 | 0.00 | 0 | 0 | passed / passed / passed |
| cas_a1a7e05d9003 | 2/3 | 67% | 0.89 | 0.19 | 2 | 0 | passed / failed / passed |
| cas_a5ce6f9f8bf4 | 2/3 | 67% | 0.89 | 0.19 | 2 | 1 | passed / failed / passed |
| cas_b39ab506785e | 3/3 | 100% | 1.00 | 0.00 | 0 | 3 | passed / passed / passed |
| cas_b5cf48dfcd20 | 0/3 | 0% | 0.67 | 0.00 | 0 | 0 | failed / failed / failed |
| cas_b89a9bc11ffd | 0/3 | 0% | 0.78 | 0.10 | 0 | 1 | failed / failed / failed |
| cas_bf6b5a2907fe | 0/3 | 0% | 0.78 | 0.10 | 0 | 0 | failed / failed / failed |
| cas_c619c1e58fdd | 3/3 | 100% | 1.00 | 0.00 | 0 | 3 | passed / passed / passed |
| cas_dde042d4a876 | 0/3 | 0% | 0.72 | 0.10 | 0 | 0 | failed / failed / failed |
| cas_f7928f3f300c | 3/3 | 100% | 1.00 | 0.00 | 0 | 3 | passed / passed / passed |

## 补充口径（R004 数据治理收尾）

- 轮次口径：run_2263d1062f41 为正式基线（已入数据中台）；run_a54d567ef655 / run_182b12eeacbe 标记 stability_round，仅稳定性看板，不计入正式发布指标。每轮 repeats=1，稳定性来自 3 次独立运行，非单轮内重复。
- 评分口径：key_points 现同时给 literalScore / semanticScore / finalScore；R004 基线按语义评分复评由 0.55 提升至 0.95（8 条原失败为评分器同义词/格式敏感，非模型错误）。上表 53.3% 为字面评分口径。
- 分类口径：cost 独立为 cost_failure；基础设施失败率含 relay_failure/timeout/cost_failure/parse_failure，不含 agent_bug/guarded/inconclusive/judge_failure。
- 空结论重试：新增 initialEmptyCount / retryCount / retryRecoveredCount / finalEmptyCount / retryRecoveryRate 与重试额外成本/耗时（估算）。
