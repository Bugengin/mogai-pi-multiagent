import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkRelayHealth, probeUrl, buildHealthPayload } from "../src/relayHealth";

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve({ server, port: addr.port });
    });
  });
}

test("relay: healthy endpoint returns ok with model count", async () => {
  const { server, port } = await listen((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }));
  });
  try {
    const r = await checkRelayHealth({ baseUrl: "http://127.0.0.1:" + port, apiKey: "k", connectTimeoutMs: 1000, readTimeoutMs: 1000, totalTimeoutMs: 2000 });
    assert.equal(r.ok, true);
    assert.equal(r.stage, "ok");
    assert.equal(r.modelCount, 2);
    assert.ok(r.latencyMs >= 0);
    assert.match(r.message, /中转可用/);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("relay: html response is flagged as not-an-api-endpoint", async () => {
  const { server, port } = await listen((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<html><body>hello</body></html>");
  });
  try {
    const r = await checkRelayHealth({ baseUrl: "http://127.0.0.1:" + port, connectTimeoutMs: 1000, readTimeoutMs: 1000, totalTimeoutMs: 2000 });
    assert.equal(r.ok, false);
    assert.equal(r.stage, "html");
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("relay: 401 is reachable but auth failed", async () => {
  const { server, port } = await listen((req, res) => {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message: "bad key" } }));
  });
  try {
    const r = await checkRelayHealth({ baseUrl: "http://127.0.0.1:" + port, apiKey: "bad", connectTimeoutMs: 1000, readTimeoutMs: 1000, totalTimeoutMs: 2000 });
    assert.equal(r.ok, false);
    assert.equal(r.reachable, true);
    assert.equal(r.authOk, false);
    assert.equal(r.stage, "auth");
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("relay: no-response endpoint times out with read/total stage and returns", async () => {
  const { server, port } = await listen(() => {
    /* never respond */
  });
  try {
    const started = Date.now();
    const r = await checkRelayHealth({ baseUrl: "http://127.0.0.1:" + port, connectTimeoutMs: 500, readTimeoutMs: 400, totalTimeoutMs: 900 });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.ok(["read", "total"].includes(r.stage), "stage should be read or total, got " + r.stage);
    assert.ok(elapsed < 3000, "probe must resolve within timeout, elapsed=" + elapsed);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("relay: connection refused fails fast with connect stage", async () => {
  const r = await probeUrl("http://127.0.0.1:1/v1/models", {}, { connectTimeoutMs: 800, readTimeoutMs: 800, totalTimeoutMs: 1500 });
  assert.equal(r.ok, false);
  assert.equal(r.reachable, false);
  assert.ok(["connect", "dns"].includes(r.stage), "stage=" + r.stage);
});

test("relay: 建连阶段超过 connectTimeoutMs 返回 connect（独立于 readTimeout）", async () => {
  // 192.0.2.0/24 是 TEST-NET-1，通常不可达，用于触发真实的建连超时
  const started = Date.now();
  const r = await probeUrl("http://192.0.2.1:81/v1/models", {}, { connectTimeoutMs: 500, readTimeoutMs: 5000, totalTimeoutMs: 6000 });
  const elapsed = Date.now() - started;
  assert.equal(r.ok, false);
  assert.equal(r.reachable, false);
  assert.equal(r.stage, "connect", "stage=" + r.stage);
  assert.ok(elapsed < 4000, "应以 connect 超时快速返回，elapsed=" + elapsed);
});

test("relay: 建连成功但无响应时触发 readTimeoutMs 返回 read", async () => {
  const { server, port } = await listen(() => {
    /* accept but never respond */
  });
  try {
    const started = Date.now();
    const r = await probeUrl("http://127.0.0.1:" + port + "/v1/models", {}, { connectTimeoutMs: 1000, readTimeoutMs: 350, totalTimeoutMs: 5000 });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.equal(r.stage, "read", "stage=" + r.stage);
    assert.ok(elapsed >= 250 && elapsed < 3000, "应约为 readTimeout，elapsed=" + elapsed);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("relay: 持续返回数据但总时长超过 totalTimeoutMs 返回 total", async () => {
  const { server, port } = await listen((req, res) => {
    res.setHeader("content-type", "application/json");
    res.write("{");
    const iv = setInterval(() => res.write(" "), 80);
    res.on("close", () => clearInterval(iv));
  });
  try {
    const started = Date.now();
    const r = await probeUrl("http://127.0.0.1:" + port + "/v1/models", {}, { connectTimeoutMs: 1000, readTimeoutMs: 2000, totalTimeoutMs: 700 });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.equal(r.stage, "total", "stage=" + r.stage);
    assert.ok(elapsed < 3000, "总超时应兜底返回，elapsed=" + elapsed);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("relay: 分块响应期间读取定时器会被重置（不误判 read 超时）", async () => {
  const { server, port } = await listen((req, res) => {
    res.setHeader("content-type", "application/json");
    let n = 0;
    const iv = setInterval(() => {
      res.write(" ");
      n++;
      if (n >= 5) {
        clearInterval(iv);
        res.end("{}");
      }
    }, 120);
    res.on("close", () => clearInterval(iv));
  });
  try {
    // read=350ms，但每 120ms 有数据 => 定时器不断重置，最终正常 end
    const r = await probeUrl("http://127.0.0.1:" + port + "/v1/models", {}, { connectTimeoutMs: 1000, readTimeoutMs: 350, totalTimeoutMs: 5000 });
    assert.equal(r.status, 200, "message=" + r.message + " stage=" + r.stage);
    assert.equal(r.stage, "http", "stage=" + r.stage);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("relay: DNS 解析失败返回 dns", async () => {
  const r = await probeUrl("http://nonexistent.invalid/v1/models", {}, { connectTimeoutMs: 2000, readTimeoutMs: 2000, totalTimeoutMs: 4000 });
  assert.equal(r.ok, false);
  assert.equal(r.reachable, false);
  assert.equal(r.stage, "dns", "stage=" + r.stage);
});

test("relay: HTTPS 对纯 HTTP 端口做 TLS 握手失败返回 connect", async () => {
  const { server, port } = await listen((req, res) => res.end("ok"));
  try {
    const r = await probeUrl("https://127.0.0.1:" + port + "/v1/models", {}, { connectTimeoutMs: 1500, readTimeoutMs: 1500, totalTimeoutMs: 4000 });
    assert.equal(r.ok, false);
    assert.equal(r.reachable, false);
    assert.equal(r.stage, "connect", "stage=" + r.stage);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("health: mock 模式不要求中转，整体 ok", () => {
  const p = buildHealthPayload({ engine: "mock", database: { ok: true }, relay: { required: false, ok: false, stage: "read", message: "down" } });
  assert.equal(p.httpStatus, 200);
  assert.equal(p.body.status, "ok");
  assert.equal(p.body.ok, true);
  assert.equal(p.body.relay.required, false);
  assert.equal(p.body.service.ok, true);
});

test("health: 真实模式中转可用 -> ok；中转读取超时 -> degraded(200)", () => {
  const ok = buildHealthPayload({ engine: "pi", database: { ok: true }, relay: { required: true, ok: true, stage: "ok", message: "ok" } });
  assert.equal(ok.body.status, "ok");
  assert.equal(ok.body.ok, true);
  const bad = buildHealthPayload({ engine: "pi", database: { ok: true }, relay: { required: true, ok: false, stage: "read", message: "读取超时" } });
  assert.equal(bad.httpStatus, 200);
  assert.equal(bad.body.status, "degraded");
  assert.equal(bad.body.ok, false);
});

test("health: 数据库不可用 -> error(503)", () => {
  const p = buildHealthPayload({ engine: "mock", database: { ok: false, error: "boom" }, relay: { required: false, ok: true } });
  assert.equal(p.httpStatus, 503);
  assert.equal(p.body.status, "error");
  assert.equal(p.body.ok, false);
});
