# 单条用例 repeats=3 稳定性复跑（R004 增强项）

日期：2026-11-23　运行：`run_5393f514dbff`　被测：`pi-multiagent@0.1.2-real`
用例集：`dsv_813d28a69acd`（20 条中选 4 条）　repeats=3　aggregation=majority　model=deepseek/deepseek-v4.1-flash-1017

## 结论

- 对 3 条历史易翻转用例（cas_60553c6453b8 / cas_a1a7e05d9003 / cas_a5ce6f9f8bf4）+ 1 条稳定对照（cas_20e3f2892fd2）执行 **每条 3 次**，共 **12 次评测尝试**：其中 3 次问候由本地护栏直接应答，9 次进入真实模型路径；一次诊断内部可能包含多次模型调用，因此不等于 12 次模型 API 调用。
- **12/12 次尝试通过，4/4 条用例各自 3/3 通过**；本轮未观察到用例内翻转或空结论。
- 说明：同义表述确实影响了旧评分（见 FLIP-ANALYSIS.md），但 `cas_a5ce6f9f8bf4` 在历史轮次也曾出现无根因结论。新一轮全过只能说明**本次选中样本**未复现不稳定，不能倒推历史翻转全部是评分问题。
- 耗时：**全部 12 次尝试**平均 **35.5s**；**仅 9 次真实模型路径**平均 **47.2s**（范围约 **29.4–83.9s**）。两组口径不同，不合并统计。
- 成本/token：总成本 **$0.685124**、总 token **1,216,831**。
- 结论范围：本结果只覆盖**选中的 4 条用例、每条 3 次**（其中 1 条为护栏对照），不能推广为全量 20 条稳定，也不能据此宣称真实模型准确率达到 100%。

## 逐用例结果

| 用例 | 问题 | 各次状态 | 通过/次数 | 均分 | 标准差 | 翻转 | 空结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cas_20e3f2892fd2 | 你好，介绍一下你自己（稳定对照） | P P P | 3/3 | 1.0 | 0.0 | 否 | 0 |
| cas_60553c6453b8 | 帮我确认 fallback path 是不是问题来源 | P P P | 3/3 | 1.0 | 0.0 | 否 | 0 |
| cas_a1a7e05d9003 | 日志里出现 unexpected null 怎么排查？ | P P P | 3/3 | 1.0 | 0.0 | 否 | 0 |
| cas_a5ce6f9f8bf4 | 导出任务日志里 rows=0 说明什么？ | P P P | 3/3 | 1.0 | 0.0 | 否 | 0 |

> 状态图例：P=passed，F=failed，E=error。

## 口径与边界

- 本轮是 **单条用例重复（within-case repeats）**，与 R004 的「3 次独立批量运行（每轮 repeats=1）」互补：
  - 三轮批量：跨轮稳定性（run_2263d1062f41 / run_a54d567ef655 / run_182b12eeacbe）；
  - 本轮：同一轮内同一条用例重复 3 次，直接观察单条稳定性。
- 样本边界：仅 4 条代表用例、单一模型与单一资料快照。若要覆盖全量，可对 20 条用例跑 repeats=3（约 **60 次评测尝试**，不等于 60 次模型 API 调用）或对关键用例跑 repeats=5。

## 实现说明（评测中台 evalplat）

为支持该实验，evalplat 增加了原生 repeats：

- `RunConfig.repeats` / `RunConfig.aggregation`；CLI 新增 `--repeats N`（1–10）与 `--aggregation average|all|majority`。
- 聚合规则与 pi 评测页一致：average=均分>=0.5；all=全部通过；majority=严格过半。
- 每条用例的逐次结果保存在报告 `results[].attempts`，并记录 `repeat_count / pass_count / representative_index`；代表答案取最高分那一次。
- 指标与报告 meta 的 token/成本按「每一次尝试」累计，不遗漏重复尝试。
- 新增 `scripts/summarize_repeats.py` 输出逐条稳定性表。
- 测试：evalplat 全量测试通过（含 repeats、逐次重判、重复口径可比性、key_points 反例/正例回归用例）。

## 复现

```powershell
# 1) 以真实引擎启动 pi，证据根指向 R004 资料快照
$env:PI_EVIDENCE_ROOT='D:\vibe coding\数据中台\agent_snapshots\rel_78bcb3f16f6b\materials\mat_248e282b1086@mver_7a77712dd5e4'
$env:PORT='8791'
npm --prefix server run start

# 2) 另开终端，用 evalplat 跑 repeats=3
$env:PYTHONPATH='D:\vibe coding\数据中台\samples\pi-demo\subject;D:\vibe coding\评测中台\eval-platform'
$env:PI_BASE='http://127.0.0.1:8791'
$env:PI_SUBJECT_VERSION='0.1.2-real'
cd 'D:\vibe coding\评测中台\eval-platform'
python -m evalplat --db 'D:\vibe coding\数据中台\samples\pi-demo\evalplat_repeats3.db' run `
  --subject 'subject_module:build_subject' `
  --dataset 'D:\vibe coding\数据中台\datasets\dsv_813d28a69acd\cases.json' `
  --cases 'cas_60553c6453b8,cas_a1a7e05d9003,cas_a5ce6f9f8bf4,cas_20e3f2892fd2' `
  --repeats 3 --aggregation majority --name 'pi-R004-repeats3' `
  --out 'D:\vibe coding\数据中台\samples\pi-demo\reports_r004_repeats3'

# 3) 汇总
python scripts/summarize_repeats.py --report '...\reports_r004_repeats3\run_5393f514dbff.json' --dataset '...\cases.json'
```

## 产物

- 报告：`D:\vibe coding\数据中台\samples\pi-demo\reports_r004_repeats3\run_5393f514dbff.json`
- 结果库：`D:\vibe coding\数据中台\samples\pi-demo\evalplat_repeats3.db`
