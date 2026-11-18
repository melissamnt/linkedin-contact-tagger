/* Profile view: tags, note, status and AI suggestion for the profile in the active tab. */

import {
  elChipsList,
  elNoteInput,
  elProfileName,
  elProfileUrl,
  elSaveBtn,
  elSavedConfirm,
  elStatusCurrent,
  elStatusEmptyHint,
  elStatusPill,
  elStatusSuggestion,
  elSuggestStatusBtn,
  elSuggestionChip,
  elSuggestionRationale,
  elSyncStatus,
  elTagList,
  elTagSuggestions,
  elTagsInput,
  flashSavedConfirm,
  isOverlayOpen,
  showView,
} from "./dom.js";
import { extractNameFromTitle, extractProfileUrl } from "./profile-url.js";
import {
  clearCachedSuggestion,
  getCachedSuggestion,
  getLocalRecord,
  getSettings,
  markSynced,
  setCachedSuggestion,
  setLocalRecord,
} from "./storage.js";
import { fetchAllRecords, fetchRemote, pushRemote } from "./sheet-sync.js";
import { callClaudeSuggestion, extractVisibleProfileText } from "./claude.js";
import { filterTags, getKnownTags, markTagsUsed, setKnownTagsFromRecords, tagColorClass } from "./tags.js";

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

// Unsaved edits per profile, kept while the panel is open, so switching to
// another tab (or profile) and back doesn't throw them away.
const drafts = new Map(); // profileUrl -> { tags, note, status }

function markDirty() {
  formDirty = true;
}

/* ---------- Tag chips ---------- */

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
  markTagsUsed(parts);
  renderTagSuggestions();
}

/* ---------- Tag autocomplete ---------- */

export async function refreshKnownTags() {
  const { records } = await fetchAllRecords();
  setKnownTagsFromRecords(records);
}

const SUGGESTION_LIMIT = 8;
let allTagsOpen = false; // the full, scrollable "All tags" list is showing instead of the top suggestions

// Picking a tag from the suggestions or the All tags list. Runs on mousedown
// (not click) with preventDefault, so the input never blurs — its blur
// handler would otherwise commit half-typed text and close the list first.
function pickTagOnMousedown(btn, tag) {
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    addTag(tag);
    elTagsInput.value = "";
    renderTagSuggestions();
    elTagsInput.focus();
  });
}

function openAllTags() {
  allTagsOpen = true;
  renderTagSuggestions();
}

function closeAllTags() {
  allTagsOpen = false;
  renderTagSuggestions();
}

function hideTagMenus() {
  allTagsOpen = false;
  elTagSuggestions.hidden = true;
  elTagList.hidden = true;
}

function renderTagSuggestions() {
  const matches = filterTags(getKnownTags(), currentTags, elTagsInput.value);
  if (allTagsOpen) renderAllTagsList(matches);
  else renderTopSuggestions(matches);
}

function renderTopSuggestions(matches) {
  elTagList.hidden = true;
  elTagSuggestions.innerHTML = "";
  elTagSuggestions.hidden = matches.length === 0;

  for (const tag of matches.slice(0, SUGGESTION_LIMIT)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-suggestion";
    btn.textContent = tag;
    pickTagOnMousedown(btn, tag);
    elTagSuggestions.appendChild(btn);
  }

  if (matches.length > SUGGESTION_LIMIT) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "tag-suggestion tag-suggestion-all";
    more.textContent = `All tags (${matches.length})`;
    more.addEventListener("mousedown", (e) => {
      e.preventDefault();
      openAllTags();
    });
    elTagSuggestions.appendChild(more);
  }
}

function renderAllTagsList(matches) {
  elTagSuggestions.hidden = true;
  elTagList.hidden = false;
  elTagList.innerHTML = "";

  const head = document.createElement("div");
  head.className = "tag-list-head";
  const title = document.createElement("span");
  title.className = "tag-list-title";
  title.textContent = elTagsInput.value.trim() ? `Matching tags (${matches.length})` : `All tags (${matches.length})`;
  const done = document.createElement("button");
  done.type = "button";
  done.className = "tag-list-done";
  done.textContent = "Done";
  done.addEventListener("click", closeAllTags);
  head.append(title, done);
  elTagList.appendChild(head);

  const items = document.createElement("div");
  items.className = "tag-list-items";
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tag-list-empty";
    empty.textContent = "No matching tags — press Enter to add it as a new tag.";
    items.appendChild(empty);
  }
  for (const tag of [...matches].sort((a, b) => a.localeCompare(b))) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-list-item";
    const dot = document.createElement("span");
    dot.className = `tag-list-dot ${tagColorClass(tag)}`;
    const label = document.createElement("span");
    label.textContent = tag;
    btn.append(dot, label);
    pickTagOnMousedown(btn, tag);
    items.appendChild(btn);
  }
  elTagList.appendChild(items);
}

/* ---------- Status ---------- */

function setStatus(status) {
  currentStatus = status || "";
  renderStatusArea();
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

export async function refreshForActiveTab() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tabs = [];
  }
  const tab = tabs[0];
  const url = tab ? extractProfileUrl(tab.url) : null;

  if (isOverlayOpen()) return; // don't yank the user out of an overlay view

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

// Back button of Settings / Browse: return to where the user was, then
// re-check the active tab (it may have changed while the overlay was open).
export function returnFromOverlay() {
  showView(viewBeforeOverlay);
  refreshForActiveTab();
}

/* ---------- Saving ---------- */

async function saveCurrentProfile() {
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
    status: currentStatus,
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
}

/* ---------- AI suggestion ---------- */

async function requestSuggestion() {
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
}

/* ---------- Event wiring ---------- */

export function initProfileView() {
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
      hideTagMenus();
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
    hideTagMenus();
  });

  // Clicks on the list's padding, header or scrollbar must not blur the input
  // (that would close the list). "Done" still gets its click.
  elTagList.addEventListener("mousedown", (e) => e.preventDefault());

  elSaveBtn.addEventListener("click", saveCurrentProfile);

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

  elSuggestStatusBtn.addEventListener("click", requestSuggestion);
}
