# Pi 多智能体协作台

> 用真实大模型（pi 引擎）做「多智能体只读排查 + 证据自动校验 + 主 Pi 真实仲裁」的本地 Web 工作台；附带数据中台（资料版本库）与评测中台联动的本地评测（rubric / LLM 裁判）。

## 快速启动

```bash
npm run install:all                 # 首次安装（root + server + web）

# 开发（前后端热更新：后端 8787 + 前端 5173）
npm run dev

# 或只跑后端（托管已构建的前端）
npm --prefix web run build
npm --prefix server run start       # http://127.0.0.1:8787
```

- 打开 http://127.0.0.1:8787 → 右上角 ⚙：填供应商/API Key →「获取可用模型」→ 选模型 →「测试连接」→ 保存。
- evalplat 看板（可选）：`cd 评测中台/eval-platform && python -m evalplat serve --port 8765`

## 功能地图

- **协作台**：主 Pi 拆解任务 → 子 agent 并行只读排查（read/grep/find/ls）→ 证据自动校验 ✓/✗ → 主 Pi **真实模型仲裁**；支持「巡检模式」（不知道问题在哪）。
- **数据**：资料版本库（导入 / 快照 / 内容哈希去重 / 修订升版本 / 历史回溯）。
- **评测**：案例集（按场景绑定 workspace）→ 真实引擎跑 → rubric/LLM 裁判 → 通过率/均分/成本/耗时 + 趋势图；可导出 evalplat JSON，或由 evalplat 用 `rubric` 算子反向驱动。
- **设置**：模型发现、限额（任务时限/费用上限/并发/卡住）、Mock/真实引擎切换。

## 技术栈 / 目录

- `server/`：Node + TypeScript + Express + `node:sqlite`（任务/资料/设置持久化）。
- `web/`：React + Vite + TypeScript（协作台 / 数据 / 评测 三个页签）。
- 引擎：`@earendil-works/pi-coding-agent`；设置存 `server/.data/settings.json`（本地明文）。
- 示例工程：`demo-workspace`(export) / `demo-api`(api500) / `demo-report`(report)，供评测排查用。

## 说明与限制

- 单用户、本地运行；不含权限系统；API Key 本机明文保存，勿提交到 git。
- 真实引擎依赖可达的模型端点/中转；本机 openai/google 官方端点可能不可达，可在设置里配 Base URL 中转。
- 评测裁判是模型，存在波动与额外成本；已加重试/二次复核，连续运行表现稳定。

---

## 开发记录 / 演进（按时间倒序追加）

# Pi 多智能体协作台（MVP 骨架）

> 用 pi 当引擎的多智能体协作产品骨架：主 Pi 拆解任务 → 子智能体并行只读排查 → 证据回传 → 主 Pi 判别性仲裁。

## 现在能跑什么

- Web 界面：输入问题 → 实时展示每个子智能体的「正在查/已查到」、结构化证据、未验证疑点。
- 每个子任务可**单独停止 / 重试**，互不影响。
- 主 Pi 面板：结论、置信度、推理链、**判别性检查**、仍未解决项。
- 默认内置一个「导出文件为空」演示场景（两个子 agent 结论冲突 → 主 Pi 仲裁），方便验证整条链路。
- 当前引擎是 **mock（确定性脚本）**，不消耗模型额度；真实 pi SDK 接入点已预留（见下）。

## 目录结构

```
pi/
  package.json         # 根脚本（concurrently 同时起 server+web）
  server/              # Node + Express + TS
    src/types.ts       # 领域模型（Task/Subtask/Evidence/Verdict）
    src/engine.ts      # 规划/步骤/结果 生成 + 真实 pi SDK 接入点(tryLoadPi)
    src/orchestrator.ts# 编排器：状态机 / 并行 / 停止 / 重试 / 仲裁
    src/index.ts       # REST + SSE 服务（127.0.0.1:8787）
  web/                 # React + Vite + TS
    src/App.tsx        # 多 agent pane + 仲裁面板 + SSE 订阅
    src/api.ts, types.ts, styles.css
```

## 启动

```bash
npm run install:all   # 安装 root + server + web 依赖
npm run dev           # 同时启动后端(8787) + 前端(5173)
```

打开 http://localhost:5173 ，输入问题点「开始排查」。
（也可 `npm --prefix web run build` 后只跑 `npm --prefix server run start`，由后端直接托管 dist。）

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/tasks | 创建任务 {goal}，返回 {taskId,task} |
| GET | /api/tasks/:id | 任务快照 |
| GET | /api/tasks/:id/events | SSE 事件流（task/subtask/log/verdict） |
| POST | /api/tasks/:id/subtasks/:sid/stop | 停止某子任务 |
| POST | /api/tasks/:id/subtasks/:sid/retry | 重试某子任务 |

## 接入真实 pi（下一步）

1. `npm --prefix server install @earendil-works/pi-coding-agent`（Node 22.19+，当前 Node 24 满足）。
2. 在 `server/src/engine.ts` 的 `tryLoadPi()` 基础上实现：
   - 主 Pi：一个 `AgentSession`，负责任务拆解与仲裁。
   - 子 agent：用 `AgentSessionRuntime.newSession()`（或 fork）为每个子任务建**独立会话**，**只给只读工具**（`tools/noTools/excludeTools` 里排除 write/edit，禁止裸 bash，改用受控只读 shell）。
   - 订阅 `session.subscribe(...)` 的 `message_update / tool_execution / agent_settled` 事件，映射为 pane 的 progress；从最终 assistant message 解析结构化 `SubtaskResult`。
   - 停止/重试用 `session.abort()`；每个子会话持久化（SessionManager）→ 天然审计链。
3. 需要模型凭据（`/login` 或 API key），无凭据时自动回落到 mock。

## 安全/可信红线（别省）

- **权限隔离**：子 agent 只读靠「工具裁剪 + OS 级沙箱」双保险，不能只靠提示词。
- **证据校验**：`evidence` 要机器可校验（文件行号存在、日志可定位、测试可复跑），校验不过打回重查。
- **仲裁协议**：结论冲突必须做判别性检查；证据不足**显式输出 inconclusive**，不硬凑。

## 与两个中台的联动（后续）

- **数据中台**：存资料快照、任务/会话记录、证据链；本产品的存储层就是它。
- **评测中台**：把每次多智能体排查当作一次可评测对象，统计「根因判断准确率 / 单任务成本 / 平均耗时」，做回归。
## 巡检模式（不知道问题在哪时）

- 首屏「我不确定，帮我先看看」→ 传 `{ mode: "recon", scope }`；
- 主 Pi 先侦察范围，产出候选问题清单（`status: awaiting_pick` + `candidates`）；
- 用户点某条 → `POST /api/tasks/:id/pick {candidateId}` → 自动转成 diagnose 并拉起子智能体。

新增接口：`POST /api/tasks/:id/pick`。`POST /api/tasks` 现支持 `mode`(diagnose|recon) 与 `scope`。
## 持久化与证据校验（本轮新增）

- **SQLite 持久化**：用 Node 内置 `node:sqlite`（无需原生依赖），任务/子会话/证据落盘到 `server/.data/pi.db`。
  - 刷新页面、重启服务后任务不丢；首屏「最近排查」可回看历史。
  - 接口：`GET /api/tasks`（列表）、`DELETE /api/tasks/:id`、`GET /api/tasks/:id`（异地从库加载）。
- **证据自动校验**：每条依据落地时校验真伪，`evidence.valid` 标记，前端显示 ✓/✗。
  - 规则：`文件:行号` 文件存在且行号在范围内；`snippet` 能在文件中找到（行号偏差会提示）；`测试文件#用例` 文件与用例存在。
  - 全部证据不通过 → 结论自动降级为「证据不足」。
  - 校验根目录：`demo-workspace/`（内含 queryBuilder.ts / writer.ts / logs / writer.spec.ts 等可校验样例）。
## 接入真实 Pi + 引擎设置（本轮新增）

- 依赖：`@earendil-works/pi-coding-agent@1.5.2`（已装进 server）。
- 设置入口：右上角「引擎：Mock/真实 Pi」徽标或 ⚙ 按钮。可填：引擎、供应商(openai/anthropic/google/openrouter/deepseek/xai/groq/mistral)、模型、API Key、Base URL，并「测试连接」。
- 设置保存到 `server/.data/settings.json`（本地明文，单人自用；不要提交到仓库）。
- 真实 pi 路径（`server/src/piEngine.ts`）：`createAgentSession` + `ModelRuntime.setRuntimeApiKey` + 只读工具白名单（read/grep/find/ls）+ 内存会话；模型输出结构化 JSON → 解析成 SubtaskResult → 走证据校验。
- **失败自动回退**：真实调用异常时回退 mock，并在该子任务「未验证疑点」里注明原因，任务不中断。
- 接口：`GET/PUT /api/settings`、`GET /api/settings/models?provider=`、`POST /api/settings/test`。
## 限额与卡住检测（本轮新增）

设置页「限额（防跑飞）」四项，均落到 settings.json：
- **任务时限** `maxTaskSeconds`（默认 300s）：整条排查超过时限 → 中止所有子任务，任务标记 failed，结论说明原因。
- **费用上限** `maxCostUsd`（默认 1.5）：累计花费超过上限 → 中止。真实 pi 的 token/费用取自 `session.getSessionStats()`；mock 用估算值。
- **最大并发** `maxConcurrency`（默认 4）：同时运行的子任务数上限，其余排队。
- **卡住判定** `stuckSeconds`（默认 90s）：子任务超过该时长无任何进展 → 标记 stuck 并 `session.abort()` 真中断。

任务条会显示本次消耗（$ 与 tokens）。
## A. 评测中台联动（本地评测）+ B. 案例沉淀 + C. 测试（本轮新增）

- **导航新增「评测」页**：内置 demo 案例集，一键运行 → 通过率 / 平均分 / 总成本 / 平均耗时 + 逐条命中/缺失。
- **口径对齐评测中台**：passRate = passed/total、avgScore、成本(USD)、耗时(ms) 四项。
- 存储：`server/.data/eval_cases.json`（案例集）、`server/.data/eval_runs.json`（历史，保留最近 50 次）。
- **B 数据中台联动**：历史排查任务（tasks/子会话/证据已持久化=数据仓库）可在评测页「加入评测集」——填期望根因关键词，沉淀成回归用例。
- 接口：`GET/POST /api/eval/cases`、`POST /api/eval/run`、`GET /api/eval/runs`、`GET /api/eval/runs/:id`。
- **C 测试**：`server/test/core.test.ts`，运行 `npm --prefix server test`（7 项，覆盖证据校验与评分口径）。
- 说明：demo 案例的关键词是按 mock 输出设的，用于验证链路；接真实 pi 后应按真实根因重设。指标口径与 evalplat 一致，后续可把本评测结果导出为 evalplat JSON 报告做统一看板。
## 真正接 evalplat（本轮新增）

- **导出报告**：评测页「导出 evalplat JSON」→ 下载与 evalplat `export --format json` **同结构**的报告（Run: metrics / results → CaseResult → SubjectResult）。
  接口：`GET /api/eval/runs/:id/export`。
- **导出数据集**：`GET /api/eval/datasets/evalplat?dataset=demo` → evalplat Dataset JSON（`expected.key_points.field = rootCause`，算子里程碑一致）。
- **让 evalplat 直接驱动本系统**：
  - 单条诊断接口 `POST /api/diag/once { goal }` → `{ output: {rootCause, confidence}, usage }`。
  - 命令适配器脚本 `server/scripts/subject-cli.mjs`（stdin 读 JSON → 调本服务 → stdout 写 JSON）。
  - 用法（evalplat 需按其安全模型**开启命令适配器**）：
    ```
    evalplat run --subject command --command "node server/scripts/subject-cli.mjs" --dataset <导出的数据集>.json
    ```
- 说明：evalplat 命令适配器默认关闭，要显式开启；导出报告可直接喂给脚本/CI，或与 evalplat 自身结果对比。

## evalplat 端到端跑通（已实测）

- 被测对象适配：`评测中台/eval-platform/subjects/pi_multiagent.py`（CommandSubject → `node pi/server/scripts/subject-cli.mjs` → 本产品 `/api/diag/once`）。
- 数据集：`评测中台/eval-platform/datasets/pi_multiagent_cases.json`（由 `GET /api/eval/datasets/evalplat?dataset=demo` 导出）。
- 运行：`cd 评测中台/eval-platform` 然后 `python -m evalplat run --subject "subjects.pi_multiagent:build_subject" --dataset datasets/pi_multiagent_cases.json`。
- 实测结果：`run_2a66107a955d` · pi-multiagent · 4 条 · 通过率 75%（3/4，c_report 未过）· 均分 0.75 · 平均 4080ms · 总成本 $0.30。
- 看板：`python -m evalplat serve --port 8765` → http://127.0.0.1:8765 可见该运行。

## 数据中台 · 资料版本库（本轮新增）

- 导航新增「数据」页；后端 `server/src/dataStore.ts`（SQLite 同库，表 `documents` / `doc_versions`）。
- 能力：导入资料即存**快照**；同「名称+来源」内容未变**不重复入库**（内容 sha256 哈希判定）；修订自动**升版本**并保留旧版；版本历史可查看任意快照；可删除。
- 接口：`GET/POST /api/data/documents`、`GET /api/data/documents/:id`、`POST /api/data/documents/:id/versions`、`GET /api/data/documents/:id/versions/:version`、`DELETE /api/data/documents/:id`。
- 单测：`test/data.test.ts`（导入/去重/升版本/快照回溯 4 项）。
- 尚未做（原方案剩余）：样本审核、发布清单（资料快照 ↔ 用例集指纹 ↔ 运行 ID 的版本对齐）、失败复核。

## 模型列表：用 Key 实时发现（本轮改动）

- 不再预设模型。设置页填好「供应商 + API Key」后点「获取可用模型」，后端会用这把 Key 请求该供应商的 `/models`，返回**实际可访问的模型**供下拉选择。
- 实现：`server/src/modelDiscovery.ts`（用 Node 原生 `https`，15s 超时；openai 兼容 / anthropic / google 三类）。
- 接口：`POST /api/settings/models/discover { provider, apiKey?, baseUrl? }`。
- 供应商无 Key 时会提示「请先填写 API Key」；OpenRouter 目录公开，可不填 Key 直接拉取。
- 注意：Base URL 一旦填写会作为该次请求的端点覆盖；若你用的是中转/代理，请在 Base URL 填对，否则会把请求打到错误地址（曾出现残留 baseUrl 劫持请求、返回 HTML 的情况，已清理）。
- 中转兼容：填中转根地址即可，系统会自动依次尝试 `{base}/v1/models` 与 `{base}/models`（多数中转的真实模型接口在 `/v1/models`）；返回 HTML / 超时 / 非 2xx 时给出带 URL 与状态的可诊断提示。

## 真实 pi 引擎跑通（已实测）

- 真实模型接入：走用户的中转（deepseek），实际模型 `deepseek-v4.1-flash-1017`。
- 关键适配：中转模型名不在 pi 内置目录 → 克隆同供应商内置模型当**模板**，只替换 `id`/`name` 并覆盖 `baseUrl`（自动补 `/v1`），compat 用通用 OpenAI 兼容配置。
- 真实任务：`task_b915a042` 完成，2 个子 agent 各跑 14/19 次工具调用（read/grep/find/ls），**证据全部 valid=True**，tokens 98605，成本约 $0.051。
- 三层复核（真实引擎）：evalplat `run_fb479731c466` · c_export 100% · 31.3s · $0.049，已入看板。
- 主 Pi 仲裁已改为**真实模型**（`adjudicateWithPi`）：把各子任务的结论/证据(valid)/疑点喂给模型做仲裁，产出 rootCause/confidence/reasoning/判别性检查。证据不足时会**诚实返回 inconclusive / rootCause=null**，不再硬套模板（模板仅作失败回退）。
- 实测 `task_8c40afdb`：真实仲裁判 s1 证据不足、s2 证伪写入层 → inconclusive、rootCause=null，并给出对照实验方案，成本 $0.050 / 71,741 tokens。

## C. 示例工程可验证化 + B. 真实引擎完整评测（已实测）

- **C**：`demo-workspace` 补成完整可验证调用链——`data/orders.json`（5 单，无 PENDING）、`queryBuilder.ts`（过滤 status=PENDING）、`writer.ts`、`exportService.ts`、`logs/*`、`writer.spec.ts`、README。模型可据此自行确认「PENDING 过滤使查询 0 行」。
- **B**：evalplat 真实引擎跑完整 demo（4 条）：`run_8e6120dfc3b9`
  - 通过率 **50%**（2/4），平均分 0.417，平均耗时 **76.9s**，总成本 **$0.2285**。
  - c_export 0.667（通过，部分关键词命中）、c_8p9n1z 1.0（通过）；c_api500 / c_report 失败——它们是通用接口/报表题，示例工程是导出专用、无相关代码，模型判证据不足，属**预期**。






## E. 按场景分 workspace 的评测（已实测）

- 每个评测用例绑定一个示例工程 `workspace`：`export`(`demo-workspace`)、`api500`(`demo-api`)、`report`(`demo-report`)。
- 后端按 `workspace` 解析出目录，pi 子 agent 在该目录只读排查，证据也在该目录校验。
- 命令适配器把 `workspace` 透传（`case.input.workspace` → `/api/diag/once`）。
- 评分：key_points 用 3 个候选关键词、命中 ≥50% 即通过（抗模型同义改写）。
- 实测（真实引擎）`run_4d733a615406`：**3/3 通过，通过率 100%，平均分 0.889，平均 25.7s**。
  - c_export：PENDING 过滤致 0 行；c_api500：handler 未判空读 ctx.user.id→500；c_report：本地时区 getDate 跨日错位。
- 看板 http://127.0.0.1:8765 可查该运行。


## F. 评分升级为 LLM 裁判（rubric）（已实测）

- 每个评测用例带 **rubric**（标准根因描述）；评测时用真实模型当裁判，按**语义**判断是否命中，输出 score / passed / 评语。
- 关键词判分只作**兜底**（裁判调用失败时）。
- 数据结构：`EvalCaseResult` 增加 `method`(llm/keyword) 与 `judgeReason`；评测页显示「判分方式 / 评语」。
- 实测（真实引擎 + LLM 裁判，3 条）：passRate **100%**、avgScore **0.967**、成本 **$0.103**、平均 **30.2s**。
- 局限：裁判本身也是模型，有波动与额外成本；生产可固定低温度、双裁判投票，或把 rubric 算子做进 evalplat。


## H. evalplat 侧 rubric 算子（已实测）

- 新增 `评测中台/eval-platform/rubric_operator.py`：算子名 `rubric`，读用例 `expected.rubric`，把 `goal + rubric + rootCause` POST 到本产品 `/api/judge/once`（真实模型裁判），返回 score/passed/reason。
- 已注册进 evalplat 内置算子（`registry.register_builtins` 里 try 导入），因此数据集 `expected: {rubric: "..."}` 可直接判分，无需每次传 `--operators`。
- 本产品新增 `POST /api/judge/once {goal,rubric,actual,workspace}`。
- 实测 `run_78fbfa1504e7`：c_api500 0.9、c_export 1.0（裁判语义判分，带评语）；c_report 该次模型空回答→0（真实波动）。
- 说明：两套评测（产品内「评测页」与 evalplat）现在都用同一套 rubric/LLM 裁判口径。


## I. 稳定性加固（已实测，连跑 3 次全绿）

- 子任务 / 仲裁 / 裁判统一走 `askJson`：JSON 解析失败自动追加纠错提示**重试（最多 3 次）**，网络异常也重试。
- 子任务提示：要求 conclusion 与 summary 一致、证据只引用真实存在的文件/行号。
- 仲裁提示：只要有子任务 conclusion=confirmed 且证据多为 valid，就采用其实质根因，不因其它 inconclusive 整体判 null。
- 裁判：解析重试 + 模棱两可（0.35~0.65）时**二次复核取平均**。
- 评测：任务空结论**自动重跑一次**。
- 实测连续 3 次：passRate 100% / 100% / 100%，avgScore 1.000×3，单次约 24–34s、$0.10–0.12。


## G. 成本/耗时趋势看板（已实测）

- 新增 `GET /api/eval/trends?limit=30`：返回最近评测的 passRate / avgScore / totalUsd / avgMs / createdAt。
- 评测页新增「成本 / 耗时 / 质量 趋势」四张图：通过率、平均分（折线），单次成本、平均耗时（柱状），纯 SVG、无第三方依赖。
- 实测当前有 7 条历史（mock→真实引擎演进）：最新一条 passRate 1.0、$0.108、24.2s。


## 清理测试数据

开发/演示过程中产生的任务、资料、评测历史都可以一键清空（保留评测用例集 eval_cases.json 与设置 settings.json）：

```bash
npm --prefix server run reset-data
```
