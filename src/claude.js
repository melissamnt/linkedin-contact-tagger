/* Status suggestion via the Claude API. */
/*
 * Runs only when the user clicks "Suggest" — never automatically. Reads the
 * visible text of the profile tab already open (no navigation, no clicks,
 * no scraping of other pages) and sends it to Claude for a proposed status.
 */

// Injected into the LinkedIn tab with chrome.scripting.executeScript, which
// serializes the function source — it must not reference anything outside itself.
export function extractVisibleProfileText() {
  const el = document.querySelector("main") || document.body;
  return (el.innerText || "").trim().slice(0, 3000);
}

export async function callClaudeSuggestion(apiKey, { name, note, pageText }) {
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
