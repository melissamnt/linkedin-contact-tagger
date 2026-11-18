"use strict";

/* ---------- Elements ---------- */

const elMain = document.getElementById("main");
const elProfileView = document.getElementById("profileView");
const elEmptyView = document.getElementById("emptyView");
const elSettingsView = document.getElementById("settingsView");

const elProfileName = document.getElementById("profileName");
const elProfileUrl = document.getElementById("profileUrl");
const elChipsList = document.getElementById("chipsList");
const elTagsInput = document.getElementById("tagsInput");
const elTagSuggestions = document.getElementById("tagSuggestions");
const elNoteInput = document.getElementById("noteInput");
const elSaveBtn = document.getElementById("saveBtn");
const elSavedConfirm = document.getElementById("savedConfirm");
const elSyncStatus = document.getElementById("syncStatus");

const elSuggestStatusBtn = document.getElementById("suggestStatusBtn");
const elStatusCurrent = document.getElementById("statusCurrent");
const elStatusPill = document.getElementById("statusPill");
const elStatusSuggestion = document.getElementById("statusSuggestion");
const elSuggestionChip = document.getElementById("suggestionChip");
const elSuggestionRationale = document.getElementById("suggestionRationale");
const elStatusEmptyHint = document.getElementById("statusEmptyHint");

const elSettingsToggle = document.getElementById("settingsToggle");
const elBackBtn = document.getElementById("backBtn");
const elWebAppUrl = document.getElementById("webAppUrl");
const elSecretToken = document.getElementById("secretToken");
const elClaudeApiKey = document.getElementById("claudeApiKey");
const elSaveSettingsBtn = document.getElementById("saveSettingsBtn");
const elSettingsSavedConfirm = document.getElementById("settingsSavedConfirm");

const elBrowseView = document.getElementById("browseView");
const elBrowseToggle = document.getElementById("browseToggle");
const elTagCloud = document.getElementById("tagCloud");
const elBrowseList = document.getElementById("browseList");
const elBrowseEmpty = document.getElementById("browseEmpty");
const elBrowseBackBtn = document.getElementById("browseBackBtn");

/* ---------- State ---------- */

let currentProfileUrl = null; // canonical linkedin.com/in/... url, or null
let currentName = "";
let currentTags = [];
let currentAddedAt = null; // ISO date the record was first saved; null until saved once
let currentStatus = ""; // "" | "Keep" | "Unsure" | "Remove" — the accepted, saveable value
let pendingSuggestion = null; // { status, rationale } — an AI suggestion not yet accepted
let viewBeforeOverlay = "empty"; // "profile" | "empty" — where Settings/Browse should return to
let loadToken = 0; // guards against stale async responses after fast tab switches
let formDirty = false; // true once the user edits tags/note/status after the form was loaded or saved

let browseRecords = [];
let browseSelectedTag = null; // null means "All"
let knownTags = []; // every tag seen across saved connections, for autocomplete
let tagColorOverrides = {}; // lowercase tag -> palette index; loaded once, kept in sync with storage

/* ---------- Profile URL / name parsing ---------- */

function extractProfileUrl(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/in\/([^/?#]+)\/?/);
  if (!match) return null;
  // Canonical form: decoded, lowercased, re-encoded — so "/in/Juan-Perez" and
  // "/in/juan-perez" (or "mar%C3%ADa" vs "maría") map to the same record.
  let slug;
  try {
    slug = encodeURIComponent(decodeURIComponent(match[1]).toLowerCase());
  } catch {
    slug = match[1].toLowerCase(); // malformed escape — don't double-encode it
  }
  return `https://www.linkedin.com/in/${slug}/`;
}

function extractNameFromTitle(title) {
  if (!title) return "";
  let t = title.replace(/^\(\d+\)\s*/, ""); // strip unread-message badge, e.g. "(3) "
  t = t.split("|")[0].trim(); // LinkedIn profile titles are "Name | LinkedIn"
  return t || "";
}

/* ---------- Storage helpers ---------- */

function profileKey(url) {
  return `profile:${url}`;
}

function suggestionKey(url) {
  return `suggestion:${url}`;
}

async function getCachedSuggestion(url) {
  const data = await chrome.storage.local.get(suggestionKey(url));
  return data[suggestionKey(url)] || null;
}

async function setCachedSuggestion(url, status, rationale) {
  await chrome.storage.local.set({ [suggestionKey(url)]: { status, rationale } });
}

async function clearCachedSuggestion(url) {
  await chrome.storage.local.remove(suggestionKey(url));
}

async function loadTagColorOverrides() {
  const { tagColors } = await chrome.storage.local.get("tagColors");
  tagColorOverrides = tagColors || {};
}

async function setTagColorOverride(tag, index) {
  tagColorOverrides[tag.toLowerCase()] = index;
  await chrome.storage.local.set({ tagColors: tagColorOverrides });
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || { webAppUrl: "", token: "", claudeApiKey: "" };
}

async function saveSettingsToStorage(settings) {
  await chrome.storage.local.set({ settings });
}

async function getLocalRecord(url) {
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

async function setLocalRecord(record) {
  await chrome.storage.local.set({ [profileKey(record.profileUrl)]: record });
}

// Clears the pendingSync flag once `record` reached the Sheet — but only if
// the local copy is still that same save (a newer save keeps its own flag).
async function markSynced(record) {
  const local = await getLocalRecord(record.profileUrl);
  if (local && local.updatedAt === record.updatedAt) {
    await setLocalRecord({ ...local, pendingSync: false });
  }
}

function markDirty() {
  formDirty = true;
}

/* ---------- Remote sync (Apps Script Web App) ---------- */
/*
 * Requests use text/plain bodies and no custom headers so they stay
 * "simple requests" and never trigger a CORS preflight — Apps Script
 * web apps cannot handle OPTIONS preflight requests.
 */

async function fetchRemote(profileUrl) {
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

async function pushRemote(record) {
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

/* ---------- Rendering ---------- */

const TAG_COLOR_COUNT = 6;

function tagColorIndex(tag) {
  const s = tag.toLowerCase();
  if (s in tagColorOverrides) return tagColorOverrides[s];

  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash % TAG_COLOR_COUNT;
}

function tagColorClass(tag) {
  return `tag-color-${tagColorIndex(tag)}`;
}

function tagStripeClass(tag) {
  return `tag-stripe-${tagColorIndex(tag)}`;
}

function renderChips() {
  elChipsList.innerHTML = "";
  for (const [index, tag] of currentTags.entries()) {
    const chip = document.createElement("span");
    chip.className = `chip ${tagColorClass(tag)}`;
    chip.textContent = tag;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.setAttribute("aria-label", `Remove tag ${tag}`);
    remove.textContent = "×";
    // Without this, clicking "×" while typing blurs the input first; the blur
    // handler re-renders the chips, the button vanishes and the click is lost.
    remove.addEventListener("mousedown", (e) => e.preventDefault());
    remove.addEventListener("click", () => {
      currentTags.splice(index, 1);
      markDirty();
      renderChips();
      renderTagSuggestions();
    });

    chip.appendChild(remove);
    elChipsList.appendChild(chip);
  }
}

function addTag(raw) {
  // The Sheet stores tags comma-separated, so a comma can never live inside
  // a tag — split pasted input like "SF, Tech" into separate tags up front.
  const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (!parts.length) return;
  for (const tag of parts) {
    const exists = currentTags.some((t) => t.toLowerCase() === tag.toLowerCase());
    if (!exists) {
      currentTags.push(tag);
      markDirty();
    }
  }
  renderChips();
  mergeKnownTags(currentTags);
  renderTagSuggestions();
}

/* ---------- Tag autocomplete ---------- */

function mergeKnownTags(tags) {
  const have = new Set(knownTags.map((t) => t.toLowerCase()));
  for (const tag of tags) {
    if (!have.has(tag.toLowerCase())) {
      knownTags.push(tag);
      have.add(tag.toLowerCase());
    }
  }
}

async function refreshKnownTags() {
  const { records } = await fetchAllRecords();
  knownTags = collectTagCounts(records).map((t) => t.label);
}

function renderTagSuggestions() {
  const query = elTagsInput.value.trim().toLowerCase();
  const applied = new Set(currentTags.map((t) => t.toLowerCase()));
  const matches = knownTags
    .filter((t) => !applied.has(t.toLowerCase()) && (query === "" || t.toLowerCase().includes(query)))
    .slice(0, 8);

  elTagSuggestions.innerHTML = "";
  elTagSuggestions.hidden = matches.length === 0;

  for (const tag of matches) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-suggestion";
    btn.textContent = tag;
    // mousedown (not click) fires before the input's blur, so the tag is
    // added before addTag()'s own blur handler would otherwise fire first.
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      addTag(tag);
      elTagsInput.value = "";
      renderTagSuggestions();
      elTagsInput.focus();
    });
    elTagSuggestions.appendChild(btn);
  }
}

function setStatus(status) {
  currentStatus = status || "";
  renderStatusArea();
}

function getStatus() {
  return currentStatus;
}

function renderStatusArea() {
  if (pendingSuggestion) {
    elStatusCurrent.hidden = true;
    elStatusEmptyHint.hidden = true;
    elSuggestionChip.hidden = false;
    elSuggestionChip.textContent = pendingSuggestion.status;
    elSuggestionChip.className = `suggestion-chip suggestion-${pendingSuggestion.status.toLowerCase()}`;
    elSuggestionRationale.textContent = pendingSuggestion.rationale;
    elStatusSuggestion.hidden = false;
    return;
  }

  elStatusSuggestion.hidden = true;

  if (currentStatus) {
    elStatusEmptyHint.hidden = true;
    elStatusPill.textContent = currentStatus;
    elStatusPill.className = `status-pill status-pill-${currentStatus.toLowerCase()}`;
    elStatusCurrent.hidden = false;
  } else {
    elStatusCurrent.hidden = true;
    elStatusEmptyHint.hidden = false;
  }
}

function showView(name) {
  elProfileView.hidden = name !== "profile";
  elEmptyView.hidden = name !== "empty";
  elSettingsView.hidden = name !== "settings";
  elBrowseView.hidden = name !== "browse";
}

function flashSavedConfirm(el) {
  el.classList.remove("is-visible");
  // force reflow so the transition restarts if triggered twice quickly
  void el.offsetWidth;
  el.classList.add("is-visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}

/* ---------- Loading a profile into the form ---------- */

function setCurrentName(name) {
  currentName = name || "";
  elProfileName.textContent = currentName || "—";
}

function applyRecordToForm(record) {
  currentTags = record?.tags ? [...record.tags] : [];
  renderChips();
  elNoteInput.value = record?.note || "";
  setStatus(record?.status || "");
  currentAddedAt = record?.addedAt || null;
  formDirty = false;
}

// Unsaved edits per profile, kept while the panel is open, so switching to
// another tab (or profile) and back doesn't throw them away.
const drafts = new Map(); // profileUrl -> { tags, note, status }

function stashDraft() {
  if (currentProfileUrl && formDirty) {
    drafts.set(currentProfileUrl, { tags: [...currentTags], note: elNoteInput.value, status: currentStatus });
  }
}

function restoreDraft(url) {
  const draft = drafts.get(url);
  if (!draft) return false;
  currentTags = [...draft.tags];
  renderChips();
  elNoteInput.value = draft.note;
  setStatus(draft.status);
  formDirty = true; // still unsaved — and keeps remote data from overwriting it
  return true;
}

async function loadProfile(url, name) {
  const myToken = ++loadToken;
  stashDraft();
  currentProfileUrl = url;
  setCurrentName(name);

  elProfileUrl.textContent = url.replace(/^https:\/\//, "");
  elProfileUrl.href = url;

  pendingSuggestion = null;
  const cached = await getLocalRecord(url);
  if (myToken !== loadToken) return;
  applyRecordToForm(cached);
  const hasDraft = restoreDraft(url);
  // The tab title can be empty or stale; fall back to the name we already know.
  if (!currentName && cached?.name) setCurrentName(cached.name);

  const { webAppUrl, token } = await getSettings();

  const cachedSuggestion = await getCachedSuggestion(url);
  if (myToken !== loadToken) return;
  if (cachedSuggestion) renderSuggestion(cachedSuggestion.status, cachedSuggestion.rationale);

  if (!webAppUrl || !token) {
    elSyncStatus.textContent = hasDraft
      ? "Unsaved changes restored — click Save to keep them."
      : cached?.pendingSync
        ? "Saved locally — add your Sheet URL in Settings to sync."
        : "Not synced — add your Sheet URL in Settings.";
    return;
  }

  elSyncStatus.textContent = "Syncing…";
  try {
    // A previous save never reached the Sheet: the local copy is the newest
    // version, so push it now instead of letting the stale remote row win.
    if (cached?.pendingSync) {
      await pushRemote(cached);
      await markSynced(cached);
      if (myToken !== loadToken) return;
      elSyncStatus.textContent = "Synced";
      return;
    }

    const { record } = await fetchRemote(url);
    if (myToken !== loadToken) return;
    // Don't clobber edits the user started while the fetch was in flight.
    if (record && !formDirty) {
      applyRecordToForm(record);
      if (!currentName && record.name) setCurrentName(record.name);
      await setLocalRecord({ ...record, profileUrl: url, name: currentName || record.name, pendingSync: false });
    }
    elSyncStatus.textContent = "Synced";
  } catch (err) {
    if (myToken !== loadToken) return;
    elSyncStatus.textContent = "Sync unavailable — showing your local copy.";
  } finally {
    if (hasDraft && myToken === loadToken) elSyncStatus.textContent = "Unsaved changes restored — click Save to keep them.";
  }
}

function loadEmpty() {
  ++loadToken; // invalidate any in-flight profile fetch
  stashDraft();
  currentProfileUrl = null;
  currentTags = [];
  pendingSuggestion = null;
  formDirty = false;
  showView("empty");
}

/* ---------- Active tab detection ---------- */

async function refreshForActiveTab() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tabs = [];
  }
  const tab = tabs[0];
  const url = tab ? extractProfileUrl(tab.url) : null;

  if (!elSettingsView.hidden || !elBrowseView.hidden) return; // don't yank the user out of an overlay view

  if (url) {
    viewBeforeOverlay = "profile";
    showView("profile");
    if (url === currentProfileUrl) {
      // Same profile — just a title/load-status change or a window refocus.
      // Reloading here would wipe unsaved edits, so only refresh the name
      // (LinkedIn often updates the title after the URL on SPA navigation).
      const freshName = extractNameFromTitle(tab.title);
      if (freshName && freshName !== currentName) setCurrentName(freshName);
      return;
    }
    let titleName = extractNameFromTitle(tab.title);
    // On SPA navigation the URL changes before the title, so the title may
    // still be the previous profile's name. Ignore it; the title-change event
    // that follows (handled above) fills in the right one.
    if (titleName === currentName) titleName = "";
    await loadProfile(url, titleName);
  } else {
    viewBeforeOverlay = "empty";
    loadEmpty();
    showView("empty");
  }
}

/* ---------- Event wiring: profile view ---------- */

elTagsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addTag(elTagsInput.value);
    elTagsInput.value = "";
    renderTagSuggestions();
  } else if (e.key === "Backspace" && elTagsInput.value === "" && currentTags.length) {
    currentTags.pop();
    markDirty();
    renderChips();
    renderTagSuggestions();
  } else if (e.key === "Escape") {
    elTagSuggestions.hidden = true;
  }
});

elTagsInput.addEventListener("input", renderTagSuggestions);
elNoteInput.addEventListener("input", markDirty);
elTagsInput.addEventListener("focus", renderTagSuggestions);

elTagsInput.addEventListener("blur", () => {
  if (elTagsInput.value.trim()) {
    addTag(elTagsInput.value);
    elTagsInput.value = "";
  }
  elTagSuggestions.hidden = true;
});

elSaveBtn.addEventListener("click", async () => {
  if (!currentProfileUrl) return;

  // Cancel any in-flight profile load so its (older) remote record can't
  // land after this save and overwrite the form or the local copy.
  ++loadToken;

  currentAddedAt = currentAddedAt || new Date().toISOString();

  const record = {
    profileUrl: currentProfileUrl,
    name: currentName,
    tags: [...currentTags],
    note: elNoteInput.value,
    status: getStatus(),
    addedAt: currentAddedAt,
    updatedAt: new Date().toISOString(),
    pendingSync: true, // cleared once the Sheet confirms; retried on next load otherwise
  };

  formDirty = false;
  drafts.delete(record.profileUrl);
  await setLocalRecord(record);
  flashSavedConfirm(elSavedConfirm);

  const isStillShown = () => currentProfileUrl === record.profileUrl;

  const { webAppUrl, token } = await getSettings();
  if (!webAppUrl || !token) {
    if (isStillShown()) elSyncStatus.textContent = "Saved locally — add your Sheet URL in Settings to sync.";
    return;
  }

  if (isStillShown()) elSyncStatus.textContent = "Syncing…";
  try {
    await pushRemote(record);
    await markSynced(record);
    if (isStillShown()) elSyncStatus.textContent = "Synced";
  } catch (err) {
    if (isStillShown()) {
      elSyncStatus.textContent = "Saved locally — sync failed, will retry when you reopen this profile.";
    }
  }
});

/* ---------- Status suggestion (Claude API) ---------- */
/*
 * Runs only when the user clicks "Suggest" — never automatically. Reads the
 * visible text of the profile tab already open (no navigation, no clicks,
 * no scraping of other pages) and sends it to Claude for a proposed status.
 */

function extractVisibleProfileText() {
  const el = document.querySelector("main") || document.body;
  return (el.innerText || "").trim().slice(0, 3000);
}

async function callClaudeSuggestion(apiKey, { name, note, pageText }) {
  const userContent = [
    `Name: ${name || "Unknown"}`,
    `My note about this person: ${note || "(none)"}`,
    "",
    "Visible text from their LinkedIn profile page:",
    pageText || "(not available)",
    "",
    "Based on this, should I Keep, be Unsure about, or Remove this connection? Give a one-sentence rationale.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      // Server-side fallback: if a safety classifier declines, the API
      // re-runs the request on a recommended fallback model in the same call.
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: "claude-opus-5-5",
      // Opus 5.5 always thinks, and thinking counts toward max_tokens — a
      // small cap (it was 300) cut the JSON off mid-answer.
      max_tokens: 16000,
      fallbacks: "default",
      system:
        'You help someone decide whether to keep, reconsider, or remove a LinkedIn connection, based on limited context. If there is not enough information to judge, choose "Unsure" and say why in your rationale.',
      messages: [{ role: "user", content: userContent }],
      output_config: {
        effort: "low", // a short classification — no need for deep reasoning
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["Keep", "Unsure", "Remove"] },
              rationale: { type: "string" },
            },
            required: ["status", "rationale"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Claude API ${res.status}`);
  if (json.stop_reason === "refusal") throw new Error("Claude declined to answer");
  if (json.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off — try again");

  const textBlock = json.content?.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No response text from Claude");
  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new Error("Claude returned an unreadable answer — try again");
  }
}

function renderSuggestion(status, rationale) {
  pendingSuggestion = { status, rationale };
  renderStatusArea();
}

function showSuggestionError(message) {
  pendingSuggestion = null;
  elStatusSuggestion.hidden = false;
  elSuggestionChip.hidden = true;
  elSuggestionRationale.textContent = message;
}

elSuggestionChip.addEventListener("click", () => {
  if (!pendingSuggestion) return;
  const status = pendingSuggestion.status;
  pendingSuggestion = null;
  setStatus(status);
  markDirty();
  if (currentProfileUrl) clearCachedSuggestion(currentProfileUrl);
});

elStatusPill.addEventListener("click", () => {
  setStatus("");
  markDirty();
});

elSuggestStatusBtn.addEventListener("click", async () => {
  if (!currentProfileUrl) return;

  // Pin the profile this request is for: the user may switch tabs while
  // Claude is thinking, and the answer must not land on the new profile.
  const url = currentProfileUrl;
  const name = currentName;
  const note = elNoteInput.value;

  const { claudeApiKey } = await getSettings();
  if (!claudeApiKey) {
    showSuggestionError("Add a Claude API key in Settings to enable suggestions.");
    return;
  }

  elSuggestStatusBtn.disabled = true;
  elSuggestStatusBtn.textContent = "Thinking…";
  pendingSuggestion = null;
  elStatusSuggestion.hidden = true;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || extractProfileUrl(tab.url) !== url) {
      throw new Error("Open the profile tab to get a suggestion");
    }

    const [{ result: pageText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractVisibleProfileText,
    });

    const { status, rationale } = await callClaudeSuggestion(claudeApiKey, { name, note, pageText });

    await setCachedSuggestion(url, status, rationale);
    if (currentProfileUrl === url) renderSuggestion(status, rationale);
  } catch (err) {
    if (currentProfileUrl === url) showSuggestionError(`Couldn't get a suggestion — ${err.message}`);
  } finally {
    elSuggestStatusBtn.disabled = false;
    elSuggestStatusBtn.textContent = "Suggest";
  }
});

/* ---------- Event wiring: settings view ---------- */

elSettingsToggle.addEventListener("click", async () => {
  const { webAppUrl, token, claudeApiKey } = await getSettings();
  elWebAppUrl.value = webAppUrl || "";
  elSecretToken.value = token || "";
  elClaudeApiKey.value = claudeApiKey || "";
  showView("settings");
});

elBackBtn.addEventListener("click", () => {
  showView(viewBeforeOverlay);
  refreshForActiveTab();
});

elSaveSettingsBtn.addEventListener("click", async () => {
  const webAppUrl = elWebAppUrl.value.trim();
  const token = elSecretToken.value.trim();
  const claudeApiKey = elClaudeApiKey.value.trim();
  await saveSettingsToStorage({ webAppUrl, token, claudeApiKey });
  flashSavedConfirm(elSettingsSavedConfirm);
  applySuggestAvailability(Boolean(claudeApiKey));
});

// Show "Suggest" only when a Claude API key is set — on startup too, not
// just after saving settings — and keep the empty-status hint consistent.
function applySuggestAvailability(hasKey) {
  elSuggestStatusBtn.hidden = !hasKey;
  elStatusEmptyHint.textContent = hasKey ? "No status yet — click Suggest." : "No status yet.";
}

/* ---------- Event wiring: browse view ---------- */

async function getAllLocalRecords() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((key) => key.startsWith("profile:"))
    .map((key) => all[key])
    .filter((record) => record && record.profileUrl);
}

// Saves that never reached the Sheet (pendingSync) exist only locally, or are
// newer than their Sheet row — show the local version so Browse isn't missing them.
function mergeWithLocal(remoteRecords, localRecords) {
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

async function fetchAllRecords() {
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

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function collectTagCounts(records) {
  const counts = new Map(); // lowercase tag -> { label, count }
  for (const record of records) {
    for (const tag of record.tags || []) {
      const key = tag.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { label: tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function renderTagCloud() {
  const tagCounts = collectTagCounts(browseRecords);
  elTagCloud.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "tag-chip tag-chip-all";
  allChip.classList.toggle("is-active", browseSelectedTag === null);
  allChip.textContent = `All (${browseRecords.length})`;
  allChip.addEventListener("click", () => {
    browseSelectedTag = null;
    renderTagCloud();
    renderBrowseList();
  });
  elTagCloud.appendChild(allChip);

  for (const { label, count } of tagCounts) {
    const chip = document.createElement("span");
    chip.className = `tag-chip ${tagColorClass(label)}`;
    chip.classList.toggle("is-active", browseSelectedTag === label.toLowerCase());

    const select = document.createElement("button");
    select.type = "button";
    select.className = "tag-chip-select";
    select.textContent = `${label} (${count})`;
    select.addEventListener("click", () => {
      browseSelectedTag = label.toLowerCase();
      renderTagCloud();
      renderBrowseList();
    });
    chip.appendChild(select);

    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "tag-swatch";
    swatch.textContent = "↻";
    swatch.title = "Change color";
    swatch.setAttribute("aria-label", `Change color for ${label}`);
    swatch.addEventListener("click", async (e) => {
      e.stopPropagation();
      const next = (tagColorIndex(label) + 1) % TAG_COLOR_COUNT;
      await setTagColorOverride(label, next);
      renderTagCloud();
      renderBrowseList();
    });
    chip.appendChild(swatch);

    elTagCloud.appendChild(chip);
  }
}

function renderBrowseList() {
  const filtered = browseSelectedTag === null
    ? browseRecords
    : browseRecords.filter((r) => (r.tags || []).some((t) => t.toLowerCase() === browseSelectedTag));

  elBrowseList.innerHTML = "";
  elBrowseEmpty.hidden = filtered.length > 0;

  for (const record of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "browse-row";
    if (record.tags && record.tags.length) {
      row.classList.add(tagStripeClass(record.tags[0]));
    }

    const main = document.createElement("div");
    main.className = "browse-row-main";

    const dot = document.createElement("span");
    const statusClass = { Keep: "status-dot-keep", Unsure: "status-dot-unsure", Remove: "status-dot-remove" }[record.status];
    dot.className = `status-dot${statusClass ? ` ${statusClass}` : ""}`;
    main.appendChild(dot);

    const name = document.createElement("span");
    name.className = "browse-row-name";
    name.textContent = record.name || "Unnamed";
    main.appendChild(name);

    row.appendChild(main);

    if (record.tags && record.tags.length) {
      const tags = document.createElement("div");
      tags.className = "browse-row-tags";
      tags.textContent = record.tags.join(" · ");
      row.appendChild(tags);
    }

    if (record.note) {
      const note = document.createElement("div");
      note.className = "browse-row-note";
      note.textContent = record.note;
      row.appendChild(note);
    }

    if (record.addedAt) {
      const added = document.createElement("div");
      added.className = "browse-row-added";
      added.textContent = `Added ${formatDate(record.addedAt)}`;
      row.appendChild(added);
    }

    row.addEventListener("click", () => chrome.tabs.create({ url: record.profileUrl }));
    elBrowseList.appendChild(row);
  }
}

elBrowseToggle.addEventListener("click", async () => {
  showView("browse");
  elTagCloud.innerHTML = "";
  elBrowseList.innerHTML = "";
  elBrowseEmpty.hidden = true;

  const { records } = await fetchAllRecords();
  browseRecords = records;
  browseSelectedTag = null;
  renderTagCloud();
  renderBrowseList();
  knownTags = collectTagCounts(records).map((t) => t.label);
});

elBrowseBackBtn.addEventListener("click", () => {
  showView(viewBeforeOverlay);
  refreshForActiveTab();
});

/* ---------- Tab change listeners ---------- */

chrome.tabs.onActivated.addListener(() => refreshForActiveTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.title || changeInfo.status === "complete")) {
    refreshForActiveTab();
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshForActiveTab();
});

/* ---------- Init ---------- */

(async function init() {
  await loadTagColorOverrides(); // avoids a color flicker on first render
  const { claudeApiKey } = await getSettings();
  applySuggestAvailability(Boolean(claudeApiKey));
  refreshForActiveTab();
  refreshKnownTags();
})();
