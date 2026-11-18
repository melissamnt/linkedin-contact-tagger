/* chrome.storage.local helpers: settings, profile records, cached suggestions. */

import { extractProfileUrl } from "./profile-url.js";

function profileKey(url) {
  return `profile:${url}`;
}

function suggestionKey(url) {
  return `suggestion:${url}`;
}

/* ---------- Settings ---------- */

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || { webAppUrl: "", token: "", claudeApiKey: "" };
}

export async function saveSettingsToStorage(settings) {
  await chrome.storage.local.set({ settings });
}

/* ---------- Cached AI suggestions ---------- */

export async function getCachedSuggestion(url) {
  const data = await chrome.storage.local.get(suggestionKey(url));
  return data[suggestionKey(url)] || null;
}

export async function setCachedSuggestion(url, status, rationale) {
  await chrome.storage.local.set({ [suggestionKey(url)]: { status, rationale } });
}

export async function clearCachedSuggestion(url) {
  await chrome.storage.local.remove(suggestionKey(url));
}

/* ---------- Profile records ---------- */

export async function getLocalRecord(url) {
  const data = await chrome.storage.local.get(profileKey(url));
  if (data[profileKey(url)]) return data[profileKey(url)];

  // Records saved before URLs were canonicalized may sit under a
  // differently-cased/encoded key — find one and move it to the new key.
  const all = await chrome.storage.local.get(null);
  for (const [key, record] of Object.entries(all)) {
    if (!key.startsWith("profile:") || !record?.profileUrl) continue;
    if (extractProfileUrl(record.profileUrl) === url) {
      const migrated = { ...record, profileUrl: url };
      await chrome.storage.local.remove(key);
      await setLocalRecord(migrated);
      return migrated;
    }
  }
  return null;
}

export async function setLocalRecord(record) {
  await chrome.storage.local.set({ [profileKey(record.profileUrl)]: record });
}

export async function getAllLocalRecords() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((key) => key.startsWith("profile:"))
    .map((key) => all[key])
    .filter((record) => record && record.profileUrl);
}

// Clears the pendingSync flag once `record` reached the Sheet — but only if
// the local copy is still that same save (a newer save keeps its own flag).
export async function markSynced(record) {
  const local = await getLocalRecord(record.profileUrl);
  if (local && local.updatedAt === record.updatedAt) {
    await setLocalRecord({ ...local, pendingSync: false });
  }
}
