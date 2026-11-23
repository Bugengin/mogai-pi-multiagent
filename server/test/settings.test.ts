import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SettingsStore } from "../src/settings";

const SECRET = "sk-test-SECRET-EXAMPLE-123";

function tmpSettings(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-settings-"));
  return path.join(dir, "settings.json");
}

test("security: api key is NOT written into settings.json", () => {
  const file = tmpSettings();
  const s = new SettingsStore(file);
  s.save({ engine: "pi", provider: "deepseek", modelId: "m", apiKey: SECRET });
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes(SECRET), "settings.json must not contain the secret");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.apiKey, undefined, "settings.json must not have apiKey field");
  assert.equal(s.load().apiKey, SECRET, "key still resolvable from credential store");
  const cred = path.join(path.dirname(file), "credentials.json");
  assert.ok(fs.existsSync(cred), "credentials.json should exist");
});

test("security: PI_API_KEY env var overrides stored credential", () => {
  const file = tmpSettings();
  const s = new SettingsStore(file);
  s.save({ apiKey: "stored-key" });
  assert.equal(s.load().apiKey, "stored-key");
  const prev = process.env.PI_API_KEY;
  process.env.PI_API_KEY = "env-key";
  try {
    assert.equal(s.load().apiKey, "env-key");
  } finally {
    if (prev === undefined) delete process.env.PI_API_KEY;
    else process.env.PI_API_KEY = prev;
  }
});

test("security: legacy apiKey in settings.json is migrated out on load", () => {
  const file = tmpSettings();
  fs.writeFileSync(file, JSON.stringify({ engine: "pi", provider: "openai", modelId: "m", apiKey: "legacy-key" }, null, 2), "utf8");
  const s = new SettingsStore(file);
  assert.equal(s.load().apiKey, "legacy-key");
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("legacy-key"), "legacy key must be removed from settings.json");
});
