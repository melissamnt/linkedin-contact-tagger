/* Settings view: Apps Script URL, secret token, Claude API key. */

import {
  elClaudeApiKey,
  elSaveSettingsBtn,
  elSecretToken,
  elSettingsSavedConfirm,
  elSettingsToggle,
  elStatusEmptyHint,
  elSuggestStatusBtn,
  elWebAppUrl,
  flashSavedConfirm,
  showView,
} from "./dom.js";
import { getSettings, saveSettingsToStorage } from "./storage.js";

// Show "Suggest" only when a Claude API key is set — on startup too, not
// just after saving settings — and keep the empty-status hint consistent.
export function applySuggestAvailability(hasKey) {
  elSuggestStatusBtn.hidden = !hasKey;
  elStatusEmptyHint.textContent = hasKey ? "No status yet — click Suggest." : "No status yet.";
}

export function initSettingsView() {
  elSettingsToggle.addEventListener("click", async () => {
    const { webAppUrl, token, claudeApiKey } = await getSettings();
    elWebAppUrl.value = webAppUrl || "";
    elSecretToken.value = token || "";
    elClaudeApiKey.value = claudeApiKey || "";
    showView("settings");
  });

  elSaveSettingsBtn.addEventListener("click", async () => {
    const webAppUrl = elWebAppUrl.value.trim();
    const token = elSecretToken.value.trim();
    const claudeApiKey = elClaudeApiKey.value.trim();
    await saveSettingsToStorage({ webAppUrl, token, claudeApiKey });
    flashSavedConfirm(elSettingsSavedConfirm);
    applySuggestAvailability(Boolean(claudeApiKey));
  });
}
