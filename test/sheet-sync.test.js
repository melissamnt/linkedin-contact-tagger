import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS, installFakeChrome, installFakeFetch } from "./helpers/fakes.js";
import { fetchAllRecords, fetchRemote, mergeWithLocal, pushRemote } from "../src/sheet-sync.js";

const URL_A = "https://www.linkedin.com/in/juan-perez/";

test("fetchRemote / pushRemote: not configured without URL and token", async () => {
  installFakeChrome();
  const calls = installFakeFetch(() => ({}));
  assert.deepEqual(await fetchRemote(URL_A), { configured: false });
  assert.deepEqual(await pushRemote({ profileUrl: URL_A }), { configured: false });
  assert.equal(calls.length, 0);
});

test("fetchRemote: sends profileUrl and token, returns the record", async () => {
  installFakeChrome(SETTINGS);
  const calls = installFakeFetch(() => ({ body: { ok: true, record: { profileUrl: URL_A, name: "Juan" } } }));

  const result = await fetchRemote(URL_A);

  assert.deepEqual(result, { configured: true, record: { profileUrl: URL_A, name: "Juan" } });
  const sent = new URL(calls[0].url);
  assert.equal(sent.searchParams.get("profileUrl"), URL_A);
  assert.equal(sent.searchParams.get("token"), "s3cret");
});

test("fetchRemote: an error in the JSON body throws even on HTTP 200", async () => {
  installFakeChrome(SETTINGS);
  installFakeFetch(() => ({ body: { ok: false, error: "Unauthorized" } }));
  await assert.rejects(fetchRemote(URL_A), /Unauthorized/);
});

test("pushRemote: simple text/plain POST without the local-only pendingSync flag", async () => {
  installFakeChrome(SETTINGS);
  const calls = installFakeFetch(() => ({ body: { ok: true } }));

  await pushRemote({ profileUrl: URL_A, note: "Met at a conference", pendingSync: true });

  const { options } = calls[0];
  assert.equal(options.method, "POST");
  assert.equal(options.headers["Content-Type"], "text/plain;charset=utf-8"); // avoids a CORS preflight
  const body = JSON.parse(options.body);
  assert.deepEqual(body, { profileUrl: URL_A, note: "Met at a conference", token: "s3cret" });
});

test("pushRemote: HTTP errors throw", async () => {
  installFakeChrome(SETTINGS);
  installFakeFetch(() => ({ status: 500 }));
  await assert.rejects(pushRemote({ profileUrl: URL_A }), /POST 500/);
});

test("mergeWithLocal: unsynced local saves replace or add to Sheet rows", () => {
  const remote = [
    { profileUrl: "https://www.linkedin.com/in/Juan-Perez/", note: "old" },
    { profileUrl: "https://www.linkedin.com/in/ana/", note: "sheet" },
  ];
  const local = [
    { profileUrl: URL_A, note: "new", pendingSync: true }, // same person, different case
    { profileUrl: "https://www.linkedin.com/in/ana/", note: "local but synced", pendingSync: false },
    { profileUrl: "https://www.linkedin.com/in/luis/", note: "only local", pendingSync: true },
  ];

  const merged = mergeWithLocal(remote, local);

  assert.deepEqual(merged.map((r) => r.note).sort(), ["new", "only local", "sheet"]);
});

test("fetchAllRecords: falls back to local records when the Sheet fails", async () => {
  installFakeChrome({ ...SETTINGS, [`profile:${URL_A}`]: { profileUrl: URL_A, name: "Juan" } });
  installFakeFetch(() => ({ status: 500 }));
  assert.deepEqual(await fetchAllRecords(), { records: [{ profileUrl: URL_A, name: "Juan" }], source: "local" });
});

test("fetchAllRecords: Sheet records merged with unsynced local ones", async () => {
  installFakeChrome({
    ...SETTINGS,
    "profile:https://www.linkedin.com/in/luis/": { profileUrl: "https://www.linkedin.com/in/luis/", pendingSync: true },
  });
  installFakeFetch((url) => {
    assert.equal(new URL(url).searchParams.get("action"), "list");
    return { body: { ok: true, records: [{ profileUrl: URL_A }] } };
  });

  const { records, source } = await fetchAllRecords();

  assert.equal(source, "remote");
  assert.deepEqual(records.map((r) => r.profileUrl).sort(), [URL_A, "https://www.linkedin.com/in/luis/"]);
});
