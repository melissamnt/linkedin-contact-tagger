import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeFetch } from "./helpers/fakes.js";
import { callClaudeSuggestion } from "../src/claude.js";

const INPUT = { name: "Juan Pérez", note: "Met at a conference", pageText: "Product designer at Acme" };

function textReply(text, extra = {}) {
  return { body: { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text }], ...extra } };
}

test("callClaudeSuggestion: returns the parsed status and rationale", async () => {
  installFakeFetch(() => textReply('{"status":"Keep","rationale":"Relevant to your work."}'));
  assert.deepEqual(await callClaudeSuggestion("sk-ant-test", INPUT), { status: "Keep", rationale: "Relevant to your work." });
});

test("callClaudeSuggestion: request shape (model, structured output, fallbacks, headers)", async () => {
  const calls = installFakeFetch(() => textReply('{"status":"Unsure","rationale":"Not enough info."}'));
  await callClaudeSuggestion("sk-ant-test", INPUT);

  const { url, options } = calls[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(options.headers["x-api-key"], "sk-ant-test");
  assert.equal(options.headers["anthropic-beta"], "server-side-fallback-2026-07-01");

  const body = JSON.parse(options.body);
  assert.equal(body.model, "claude-opus-5-5");
  assert.ok(body.max_tokens >= 4000, "room for thinking + JSON");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.deepEqual(body.output_config.format.schema.properties.status.enum, ["Keep", "Unsure", "Remove"]);
  assert.match(body.messages[0].content, /Juan Pérez/);
  assert.match(body.messages[0].content, /Met at a conference/);
  assert.match(body.messages[0].content, /Product designer at Acme/);
});

test("callClaudeSuggestion: API errors surface the API's message", async () => {
  installFakeFetch(() => ({ status: 401, body: { error: { message: "invalid x-api-key" } } }));
  await assert.rejects(callClaudeSuggestion("bad", INPUT), /invalid x-api-key/);
});

test("callClaudeSuggestion: refusal, truncation and bad JSON give clear errors", async () => {
  installFakeFetch(() => ({ body: { stop_reason: "refusal", content: [] } }));
  await assert.rejects(callClaudeSuggestion("k", INPUT), /declined/);

  installFakeFetch(() => textReply('{"status":"Ke', { stop_reason: "max_tokens" }));
  await assert.rejects(callClaudeSuggestion("k", INPUT), /cut off/);

  installFakeFetch(() => textReply("not json"));
  await assert.rejects(callClaudeSuggestion("k", INPUT), /unreadable/);

  installFakeFetch(() => ({ body: { stop_reason: "end_turn", content: [] } }));
  await assert.rejects(callClaudeSuggestion("k", INPUT), /No response text/);
});
