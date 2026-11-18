# LinkedIn Contact Tagger

A Chrome extension (Manifest V3) for tagging, annotating, and remembering your LinkedIn connections — synced privately to your own Google Sheet.

## Features

- **Chrome side panel** that opens automatically on `linkedin.com/in/...` profiles, showing the person's name, tags, a note ("where I met them"), and a status.
- **Tags** as colored chips — each tag gets a deterministic color from a 6-color palette, consistent everywhere it appears. Recently used tags are suggested as you type, and **All tags** opens a checklist of every tag.
- **Tag families** — write `Education > Stanford LEAD` to put a tag in a family. Chips show just "Stanford LEAD" in the family's color (every tag in a family shares it), suggestions and the All tags list are grouped by family, and in Browse people checking a family checks all its tags.
- **AI status suggestion** — an optional "Suggest" button that reads the visible text of the profile you're on and asks Claude whether to Keep, stay Unsure about, or Remove the connection, with a one-sentence rationale. Runs only when you click it — no background scraping or automation.
- **Browse people** — filter your connections with a checklist of tags (All, or any mix) and sort them by date added (newest or oldest first), each row showing all of the person's tags as colored chips plus a status dot; click through to open their profile.
- **Tag manager** — every tag with how many contacts use it, sorted by most used, A–Z or Z–A; rename a tag (everywhere, including your Sheet) or change its color.
- **Google Sheet sync** via a small Apps Script backend you deploy yourself (see [DEPLOY.md](DEPLOY.md)). Your data lives in your own Sheet, not a third-party server.
- No scraping, no DOM injection into LinkedIn, no automated clicks — the extension only reads the tab title and (on-demand, for AI suggestions only) the visible text of the page you're already looking at.

## Setup

See [DEPLOY.md](DEPLOY.md) for the full walkthrough: deploying the Google Sheet backend, loading the unpacked extension, and (optionally) adding a Claude API key for status suggestions.

## Project structure

```
manifest.json        Extension manifest (MV3)
background.js         Service worker (opens the side panel)
sidepanel.html/css    Side panel markup and styles
sidepanel.js          Side panel entry point (ES module: wires views + tab listeners)
src/                  Side panel modules
  profile-url.js        URL canonicalization, name from tab title (pure)
  storage.js            chrome.storage.local: settings, records, cached suggestions
  sheet-sync.js         Apps Script Web App sync
  claude.js             Claude API status suggestion
  records.js            Sort contacts by date added
  tags.js               Tag families, colors, counts, autocomplete, rename + sort helpers
  dom.js                Element references + shared view helpers
  profile-view.js       Profile form: tags, note, status, save, suggest
  browse-view.js        Browse people (tag checklist filter)
  tag-manager-view.js   Tag manager: sort, rename, recolor
  settings-view.js      Settings view
apps-script/Code.gs    Google Apps Script backend (doGet/doPost)
fonts/, icons/         Bundled assets (no external font/CDN requests)
```

## Tests

Unit tests use Node's built-in test runner — no dependencies to install. With Node 22 or newer:

```bash
npm test
```

They cover the modules in `src/` (with in-memory fakes for `chrome.storage` and `fetch`) and `apps-script/Code.gs` (run in a sandbox with fake Google services), including a check that both sides canonicalize profile URLs the same way. The side panel UI itself is still tested by hand in Chrome. CI runs the tests on every pull request.

## Privacy

Your Apps Script Web App URL, secret token, and Claude API key are stored only in `chrome.storage.local` on your machine — nothing is hardcoded in the source, and nothing is sent anywhere except your own Apps Script deployment and (if configured) the Claude API directly from your browser.
