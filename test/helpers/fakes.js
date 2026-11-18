/*
 * Minimal in-memory stand-ins for the browser APIs the modules touch,
 * so tests run in plain Node with no dependencies.
 */

// Installs globalThis.chrome with an in-memory chrome.storage.local.
// Returns the backing object so tests can inspect or seed it directly.
export function installFakeChrome(initial = {}) {
  const store = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return structuredClone(store);
          const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const out = {};
          for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
          return out;
        },
        async set(items) {
          Object.assign(store, structuredClone(items));
        },
        async remove(keys) {
          for (const k of typeof keys === "string" ? [keys] : keys) delete store[k];
        },
      },
    },
  };
  return store;
}

// Installs globalThis.fetch that answers with `handler(url, options)`'s
// return value ({ status = 200, body }). Records every call in `calls`.
export function installFakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const { status = 200, body = {} } = (await handler(String(url), options)) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
  };
  return calls;
}

export const SETTINGS = {
  settings: { webAppUrl: "https://script.google.com/macros/s/abc/exec", token: "s3cret", claudeApiKey: "sk-ant-test" },
};
