/*
 * Side panel entry point. Wires up the views and the tab listeners.
 * The logic lives in src/:
 *   profile-url.js   URL canonicalization + name-from-title (pure)
 *   storage.js       chrome.storage.local: settings, records, cached suggestions
 *   sheet-sync.js    Apps Script Web App (Google Sheet) sync
 *   claude.js        Claude API status suggestion
 *   tags.js          tag colors, counts, autocomplete (recent order + filter)
 *   dom.js           element references + shared view helpers
 *   profile-view.js  the profile form (tags, note, status, save, suggest)
 *   browse-view.js   browse-by-tag view + tag rename/recolor editor
 *   settings-view.js settings view
 */

import { elBackBtn, elBrowseBackBtn } from "./src/dom.js";
import { getSettings } from "./src/storage.js";
import { loadTagColorOverrides } from "./src/tags.js";
import { initProfileView, refreshForActiveTab, refreshKnownTags, returnFromOverlay } from "./src/profile-view.js";
import { initBrowseView } from "./src/browse-view.js";
import { applySuggestAvailability, initSettingsView } from "./src/settings-view.js";

initProfileView();
initBrowseView();
initSettingsView();

elBackBtn.addEventListener("click", returnFromOverlay);
elBrowseBackBtn.addEventListener("click", returnFromOverlay);

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
