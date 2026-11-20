import type { EngineSettings } from "./settings";
import type { Task, Subtask, SubtaskResult, Evidence, Conclusion, TaskVerdict } from "./types";

export interface TestResult {
  ok: boolean;
  message: string;
}

async function loadSdk(): Promise<any> {
  return await import("@earendil-works/pi-coding-agent");
}
async function loadAi(): Promise<any> {
  return await import("@earendil-works/pi-ai/compat");
}

async function makeSession(settings: EngineSettings, cwd: string): Promise<any> {
  const sdk = await loadSdk();
  const ai = await loadAi();
  let model: any = ai.getModel(settings.provider, settings.modelId);
  let providerId: string = settings.provider;
  if (!model) {
    const tmplCandidates: any[] = [ai.getModel(settings.provider, "deepseek-v4-pro"), ai.getModel("deepseek", "deepseek-v4-pro")];
    let template: any = null;
    for (const t of tmplCandidates) { if (t) { template = t; break; } }
    if (!template) {
      const list = ai.getModels(settings.provider) || [];
      const fallback = list.length ? list : (ai.getModels("openai") || []);
      template = fallback[0];
    }
    if (!template) throw new Error("无法为模型准备模板: " + settings.provider + "/" + settings.modelId);
    model = { ...template, id: settings.modelId, name: settings.modelId, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsStrictMode: false } };
    providerId = template.provider || settings.provider;
  }
  if (settings.baseUrl) {
    let b = settings.baseUrl.trim().replace(/\/+$/, "");
    if (!/\/v1$/i.test(b) && !/\/v\d+$/i.test(b)) b = b + "/v1";
    try { (model as Record<string, unknown>).baseUrl = b; } catch { /* ignore */ }
  }
  const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false });
  if (settings.apiKey) await runtime.setRuntimeApiKey(providerId, settings.apiKey);
  const { session } = await sdk.createAgentSession({
    cwd,
    modelRuntime: runtime,
    model,
    tools: ["read", "grep", "find", "ls"],
    sessionManager: sdk.SessionManager.inMemory()
  });
  return session;
}

export async function testConnection(settings: EngineSettings, cwd: string): Promise<TestResult> {
  try {
    const session = await makeSession(settings, cwd);
    let streamed = "";
    const unsub = session.subscribe((ev: any) => {
      try {
        if (ev.type === "message_update" && ev.assistantMessageEvent && ev.assistantMessageEvent.type === "text_delta") streamed += ev.assistantMessageEvent.delta;
      } catch { /* ignore */ }
    });
    try { await session.prompt("只回复两个字：可以"); } finally { try { unsub(); } catch { /* ignore */ } }
    const last = typeof session.getLastAssistantText === "function" ? session.getLastAssistantText() : "";
    const out = String(last || streamed || "").trim();
    let usage = "";
    try { const st = session.getSessionStats(); if (st && st.tokens) usage = "（tokens " + st.tokens.total + "）"; } catch { /* ignore */ }
    try { session.dispose(); } catch { /* ignore */ }
    return { ok: true, message: "连接成功：" + (out.slice(0, 160) || "(无文本输出)") + usage };
  } catch (e) {
    return { ok: false, message: "连接失败：" + String(e).slice(0, 300) };
  }
}

function extractJson(s: string): any | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function retryHint(attempt: number): string {
  return attempt === 0 ? "" : "\n\n注意：上一次输出无法被解析为 JSON。请严格只输出一个 JSON 对象（以 { 开头、} 结尾），不要任何解释或 Markdown 代码块。";
}

/** 让模型输出 JSON；解析失败自动加纠错提示重试，网络异常也重试。 */
async function askJson(session: any, prompt: string, maxTries: number, readText: () => string): Promise<{ json: any | null; raw: string }> {
  let raw = "";
  for (let i = 0; i < maxTries; i++) {
    try {
      await session.prompt(prompt + retryHint(i));
    } catch (e) {
      if (i === maxTries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    raw = readText();
    if (raw && raw.trim()) {
      const json = extractJson(raw);
      if (json) return { json, raw };
    }
  }
  return { json: null, raw };
}

function coerceConclusion(v: unknown): Conclusion {
  return v === "confirmed" || v === "refuted" || v === "inconclusive" ? v : "inconclusive";
}
function coerceConfidence(v: unknown): TaskVerdict["confidence"] {
  return v === "high" || v === "medium" || v === "low" || v === "inconclusive" ? v : "low";
}
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

export async function runPiSubtask(
  settings: EngineSettings,
  task: Task,
  sub: Subtask,
  cwd: string,
  onProgress: (msg: string) => void,
  registerAbort?: (fn: () => void) => void
): Promise<SubtaskResult> {
  const session = await makeSession(settings, cwd);
  if (registerAbort) registerAbort(() => { try { session.abort(); } catch { /* ignore */ } });
  let streamed = "";
  const unsub = session.subscribe((ev: any) => {
    try {
      if (ev.type === "tool_execution_start") {
        const input = ev.input ? JSON.stringify(ev.input).slice(0, 80) : "";
        onProgress("调用 " + (ev.toolName || "tool") + " " + input);
      } else if (ev.type === "message_update" && ev.assistantMessageEvent && ev.assistantMessageEvent.type === "text_delta") {
        streamed += ev.assistantMessageEvent.delta;
      }
    } catch { /* ignore */ }
  });
  const readText = () => {
    const l = typeof session.getLastAssistantText === "function" ? session.getLastAssistantText() : "";
    return String(l || streamed || "");
  };
  const prompt = [
    "你是只读排查子智能体，禁止修改任何文件。",
    "总目标：" + task.goal,
    "你负责的子任务：" + sub.title + "（假设：" + sub.hypothesis + "）",
    "工作区目录（只读）：" + cwd,
    "要求：conclusion 必须与 summary 一致；summary 要直接给出你判断的实质根因；evidence 只引用你实际读到的、确实存在的文件和行号（不要编造）。",
    "请用 read / grep / find / ls 在本工作区里查证，然后只输出一个 JSON 对象（不要解释、不要 Markdown 代码块）：",
    '{"conclusion":"confirmed|refuted|inconclusive","summary":"一句话结论","evidence":[{"type":"code|log|test","locator":"相对文件:行号 或 测试文件#用例","snippet":"关键片段","verify":"如何复核"}],"doubts":["未验证疑点"]}'
  ].join("\n");

  const { json, raw } = await askJson(session, prompt, 3, readText);
  try { unsub(); } catch { /* ignore */ }
  let cost = { tokens: 0, usd: 0 };
  try { const st = session.getSessionStats(); if (st && st.tokens) cost = { tokens: Number(st.tokens.total || 0), usd: Number(st.cost || 0) }; } catch { /* ignore */ }
  try { session.dispose(); } catch { /* ignore */ }

  if (!json) {
    return { conclusion: "inconclusive", summary: "模型多次未返回可解析的结构化结果", evidence: [], doubts: ["原始输出：" + raw.slice(0, 240)], cost };
  }
  const rawEvidence: any[] = Array.isArray(json.evidence) ? json.evidence : [];
  const evidence: Evidence[] = rawEvidence.map((e) => ({
    type: e && (e.type === "log" || e.type === "test") ? e.type : "code",
    locator: String((e && e.locator) || ""),
    snippet: e && e.snippet ? String(e.snippet) : undefined,
    verify: e && e.verify ? String(e.verify) : undefined
  })).filter((e) => e.locator);
  const doubts: string[] = Array.isArray(json.doubts) ? json.doubts.map((d: unknown) => String(d)) : [];
  return { conclusion: coerceConclusion(json.conclusion), summary: String(json.summary || "(无结论摘要)"), evidence, doubts, cost };
}

export async function adjudicateWithPi(settings: EngineSettings, task: Task, cwd: string): Promise<TaskVerdict> {
  const session = await makeSession(settings, cwd);
  let streamed = "";
  const unsub = session.subscribe((ev: any) => {
    try { if (ev.type === "message_update" && ev.assistantMessageEvent && ev.assistantMessageEvent.type === "text_delta") streamed += ev.assistantMessageEvent.delta; } catch { /* ignore */ }
  });
  const readText = () => {
    const l = typeof session.getLastAssistantText === "function" ? session.getLastAssistantText() : "";
    return String(l || streamed || "");
  };
  const payload = task.subtasks.map((s) => ({
    id: s.id, title: s.title, hypothesis: s.hypothesis, status: s.status,
    conclusion: s.result ? s.result.conclusion : null,
    summary: s.result ? s.result.summary : null,
    evidence: s.result ? s.result.evidence.map((e) => ({ type: e.type, locator: e.locator, valid: e.valid })) : [],
    doubts: s.result ? s.result.doubts : []
  }));
  const prompt = [
    "你是主控智能体，负责对多个子任务的排查结果做最终仲裁。",
    "总目标：" + task.goal,
    "下面是各子任务的结论、证据（valid=是否通过校验）和未验证疑点：",
    JSON.stringify(payload, null, 2),
    "请基于这些真实证据判断根因：",
    "1) 如果结论矛盾，指出哪个假说证据更强，并给出一个能区分两者的「判别性检查」。",
    "2) 如果证据不足或矛盾无法判定，confidence 用 low/inconclusive，rootCause 可为 null。",
    "3) 只能依据上面给出的证据，不要编造未出现的文件/行号。",
    "4) 只要有一个子任务 conclusion=confirmed 且其证据多为 valid，就把该子任务描述的实质根因作为 rootCause，不要因为其它子任务 inconclusive 就整体判 null。",
    "只输出一个 JSON 对象（不要解释、不要 Markdown 代码块）：",
    '{"rootCause":"结论或null","confidence":"high|medium|low|inconclusive","reasoning":["依据1","依据2"],"discriminatingCheck":"可选","unresolved":["仍未解决的疑点"]}'
  ].join("\n");

  const { json } = await askJson(session, prompt, 3, readText);
  try { unsub(); } catch { /* ignore */ }
  try { session.dispose(); } catch { /* ignore */ }
  if (!json) throw new Error("仲裁多次未返回可解析 JSON");
  return {
    rootCause: json.rootCause === undefined ? null : (json.rootCause === null ? null : String(json.rootCause)),
    confidence: coerceConfidence(json.confidence),
    reasoning: Array.isArray(json.reasoning) ? json.reasoning.map((x: unknown) => String(x)) : [],
    discriminatingCheck: json.discriminatingCheck ? String(json.discriminatingCheck) : undefined,
    unresolved: Array.isArray(json.unresolved) ? json.unresolved.map((x: unknown) => String(x)) : []
  };
}

/** LLM 裁判：按 rubric 语义判分；解析失败重试，分歧分做二次复核。 */
export async function judgeAnswer(
  settings: EngineSettings,
  goal: string,
  rubric: string,
  actual: string,
  cwd: string
): Promise<{ score: number; passed: boolean; reason: string }> {
  const session = await makeSession(settings, cwd);
  let streamed = "";
  const unsub = session.subscribe((ev: any) => {
    try { if (ev.type === "message_update" && ev.assistantMessageEvent && ev.assistantMessageEvent.type === "text_delta") streamed += ev.assistantMessageEvent.delta; } catch { /* ignore */ }
  });
  const readText = () => {
    const l = typeof session.getLastAssistantText === "function" ? session.getLastAssistantText() : "";
    return String(l || streamed || "");
  };
  const prompt = [
    "你是严格的评卷人。判断「被测回答」是否正确解释了下面这个问题的根因。",
    "问题：" + goal,
    "标准根因(rubric)：" + (rubric || "(无 rubric)"),
    "被测回答：" + (actual || "(空)"),
    "判定要求：只要核心根因语义一致/等价就算正确，不要求和 rubric 措辞相同；若为空或明显偏离则不正确。",
    '只输出 JSON：{"score":0到1,"passed":true或false,"reason":"简要评语"}'
  ].join("\n");

  const first = await askJson(session, prompt, 3, readText);
  let score = 0, passed = false, reason = "";
  if (first.json) {
    score = isFinite(Number(first.json.score)) ? clamp01(Number(first.json.score)) : (first.json.passed ? 1 : 0);
    passed = !!first.json.passed;
    reason = String(first.json.reason || "");
  }
  // 模棱两可（0.35~0.65）时做二次复核取平均
  if (first.json && score >= 0.35 && score <= 0.65) {
    try {
      const second = await askJson(session, prompt, 2, readText);
      if (second.json) {
        const s2 = isFinite(Number(second.json.score)) ? clamp01(Number(second.json.score)) : (second.json.passed ? 1 : 0);
        score = clamp01((score + s2) / 2);
        passed = score >= 0.5 && (passed || !!second.json.passed);
        reason = reason + " ｜ 复核:" + String(second.json.reason || "");
      }
    } catch { /* ignore */ }
  }
  try { unsub(); } catch { /* ignore */ }
  try { session.dispose(); } catch { /* ignore */ }
  if (!first.json) throw new Error("judge: 多次未返回可解析 JSON");
  return { score, passed, reason };
}
