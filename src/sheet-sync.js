/* Remote sync with the user's Apps Script Web App (Google Sheet backend). */
/*
 * Requests use text/plain bodies and no custom headers so they stay
 * "simple requests" and never trigger a CORS preflight — Apps Script
 * web apps cannot handle OPTIONS preflight requests.
 */

import { extractProfileUrl } from "./profile-url.js";
import { getSettings, getAllLocalRecords } from "./storage.js";

export async function fetchRemote(profileUrl) {
  const { webAppUrl, token } = await getSettings();
  if (!webAppUrl || !token) return { configured: false };

  const url = new URL(webAppUrl);
  url.searchParams.set("profileUrl", profileUrl);
  url.searchParams.set("token", token);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const json = await res.json();
  // Apps Script web apps always answer HTTP 200, so failures (e.g. a bad
  // token) only show up in the JSON body, never as a non-2xx status.
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return { configured: true, record: json.record || null };
}

export async function pushRemote(record) {
  const { webAppUrl, token } = await getSettings();
  if (!webAppUrl || !token) return { configured: false };

  const { pendingSync, ...payload } = record; // local-only bookkeeping, not a Sheet column
  const res = await fetch(webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return { configured: true };
}

// Saves that never reached the Sheet (pendingSync) exist only locally, or are
// newer than their Sheet row — show the local version so Browse isn't missing them.
export function mergeWithLocal(remoteRecords, localRecords) {
  const byUrl = new Map();
  for (const r of remoteRecords) {
    const key = extractProfileUrl(r.profileUrl) || r.profileUrl;
    byUrl.set(key, r);
  }
  for (const local of localRecords) {
    if (!local.pendingSync) continue;
    byUrl.set(extractProfileUrl(local.profileUrl) || local.profileUrl, local);
  }
  return [...byUrl.values()];
}

export async function fetchAllRecords() {
  const { webAppUrl, token } = await getSettings();
  if (webAppUrl && token) {
    try {
      const url = new URL(webAppUrl);
      url.searchParams.set("action", "list");
      url.searchParams.set("token", token);
      const res = await fetch(url.toString(), { method: "GET" });
      if (!res.ok) throw new Error(`GET ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Unknown error");
      return { records: mergeWithLocal(json.records || [], await getAllLocalRecords()), source: "remote" };
    } catch (err) {
      // fall through to local cache below
    }
  }
  return { records: await getAllLocalRecords(), source: "local" };
}
