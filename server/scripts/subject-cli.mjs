// evalplat 命令适配器被测程序：从 stdin 读一条 JSON，向 stdout 写一条 JSON。
// 输入: {"goal": "..."} 或 {"input": {"goal": "..."}}
// 输出: {"output": {"rootCause": "...", "confidence": "..."}, "usage": {...}}
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  let obj = {};
  try { obj = JSON.parse(raw || "{}"); } catch { obj = {}; }
  const goal = obj.goal || (obj.input && obj.input.goal) || obj.prompt || raw;
  const workspace = obj.workspace || (obj.input && obj.input.workspace) || undefined;
  try {
    const res = await fetch("http://127.0.0.1:8787/api/diag/once", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, workspace })
    });
    const j = await res.json();
    process.stdout.write(JSON.stringify({
      output: j.output,
      cost_usd: j.usage ? j.usage.cost_usd : 0,
      usage: { tokens_in: null, tokens_out: j.usage ? j.usage.tokens : null }
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e) }));
  }
});