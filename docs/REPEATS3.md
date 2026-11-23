# 单条用例 repeats=3 稳定性复跑（R004 增强项）

日期：2026-11-23　运行：`run_5393f514dbff`　被测：`pi-multiagent@0.1.2-real`
用例集：`dsv_813d28a69acd`（20 条中选 4 条）　repeats=3　aggregation=majority　model=deepseek/deepseek-v4.1-flash-1017

## 结论

- 对 3 条历史易翻转用例（cas_60553c6453b8 / cas_a1a7e05d9003 / cas_a5ce6f9f8bf4）+ 1 条稳定对照（cas_20e3f2892fd2）执行 **每条 3 次**，共 12 次真实模型尝试。
- **4/4 用例 3 次全部通过（P P P）**；**用例内翻转 0/4（0%）**；**空结论 0 次**；均分 1.0、标准差 0.0。
- 说明：在**当前语义 key_points 评分**下，此前的翻转主要是评分器同义词敏感（见 FLIP-ANALYSIS.md），不是模型能力抖动；单条用例重复 3 次未观察到不稳定。
- 成本/耗时：总成本 **$0.685124**、总 token **1,216,831**、平均每次尝试延迟 **35.5s**（29–84s）。

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
- 样本边界：仅 4 条代表用例、单一模型与单一资料快照。若要覆盖全量，可对 20 条用例跑 repeats=3（约 60 次调用）或对关键用例跑 repeats=5。

## 实现说明（评测中台 evalplat）

为支持该实验，evalplat 增加了原生 repeats：

- `RunConfig.repeats` / `RunConfig.aggregation`；CLI 新增 `--repeats N`（1–10）与 `--aggregation average|all|majority`。
- 聚合规则与 pi 评测页一致：average=均分>=0.5；all=全部通过；majority=严格过半。
- 每条用例的逐次结果保存在报告 `results[].attempts`，并记录 `repeat_count / pass_count / representative_index`；代表答案取最高分那一次。
- 指标与报告 meta 的 token/成本按「每一次尝试」累计，不遗漏重复尝试。
- 新增 `scripts/summarize_repeats.py` 输出逐条稳定性表。
- 测试：evalplat `193 passed`（含新增 repeats 用例）。

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
