/* DOM element references and small view helpers shared by every view. */

const $ = (id) => document.getElementById(id);

export const elProfileView = $("profileView");
export const elEmptyView = $("emptyView");
export const elSettingsView = $("settingsView");
export const elBrowseView = $("browseView");

// Profile view
export const elProfileName = $("profileName");
export const elProfileUrl = $("profileUrl");
export const elChipsList = $("chipsList");
export const elTagsInput = $("tagsInput");
export const elTagSuggestions = $("tagSuggestions");
export const elTagList = $("tagList");
export const elNoteInput = $("noteInput");
export const elSaveBtn = $("saveBtn");
export const elSavedConfirm = $("savedConfirm");
export const elSyncStatus = $("syncStatus");

// Status + AI suggestion
export const elSuggestStatusBtn = $("suggestStatusBtn");
export const elStatusCurrent = $("statusCurrent");
export const elStatusPill = $("statusPill");
export const elStatusSuggestion = $("statusSuggestion");
export const elSuggestionChip = $("suggestionChip");
export const elSuggestionRationale = $("suggestionRationale");
export const elStatusEmptyHint = $("statusEmptyHint");

// Settings view
export const elSettingsToggle = $("settingsToggle");
export const elBackBtn = $("backBtn");
export const elWebAppUrl = $("webAppUrl");
export const elSecretToken = $("secretToken");
export const elClaudeApiKey = $("claudeApiKey");
export const elSaveSettingsBtn = $("saveSettingsBtn");
export const elSettingsSavedConfirm = $("settingsSavedConfirm");

// Browse view
export const elBrowseToggle = $("browseToggle");
export const elTagCloud = $("tagCloud");
export const elTagEditor = $("tagEditor");
export const elBrowseList = $("browseList");
export const elBrowseEmpty = $("browseEmpty");
export const elBrowseBackBtn = $("browseBackBtn");

export function showView(name) {
  elProfileView.hidden = name !== "profile";
  elEmptyView.hidden = name !== "empty";
  elSettingsView.hidden = name !== "settings";
  elBrowseView.hidden = name !== "browse";
}

export function isOverlayOpen() {
  return !elSettingsView.hidden || !elBrowseView.hidden;
}

export function flashSavedConfirm(el) {
  el.classList.remove("is-visible");
  // force reflow so the transition restarts if triggered twice quickly
  void el.offsetWidth;
  el.classList.add("is-visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}
