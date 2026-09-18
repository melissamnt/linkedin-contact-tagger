# LinkedIn Contact Tagger

A Chrome extension (Manifest V3) for tagging, annotating, and remembering your LinkedIn connections — synced privately to your own Google Sheet.

## Features

- **Chrome side panel** that opens automatically on `linkedin.com/in/...` profiles, showing the person's name, tags, a note ("where I met them"), and a status.
- **Tags** as colored chips — each tag gets a deterministic color from a 6-color palette, consistent everywhere it appears. Click the ↻ swatch on a tag in the Browse view to change its color.
- **AI status suggestion** — an optional "Suggest" button that reads the visible text of the profile you're on and asks Claude whether to Keep, stay Unsure about, or Remove the connection, with a one-sentence rationale. Runs only when you click it — no background scraping or automation.
- **Browse by tag** — see every connection under a given tag, with a colored stripe and status dot per row; click through to open their profile.
- **Google Sheet sync** via a small Apps Script backend you deploy yourself (see [DEPLOY.md](DEPLOY.md)). Your data lives in your own Sheet, not a third-party server.
- No scraping, no DOM injection into LinkedIn, no automated clicks — the extension only reads the tab title and (on-demand, for AI suggestions only) the visible text of the page you're already looking at.

## Setup

See [DEPLOY.md](DEPLOY.md) for the full walkthrough: deploying the Google Sheet backend, loading the unpacked extension, and (optionally) adding a Claude API key for status suggestions.

## Project structure

```
manifest.json        Extension manifest (MV3)
background.js         Service worker (opens the side panel)
sidepanel.html/css/js Side panel UI and logic
apps-script/Code.gs    Google Apps Script backend (doGet/doPost)
fonts/, icons/         Bundled assets (no external font/CDN requests)
```

## Privacy

Your Apps Script Web App URL, secret token, and Claude API key are stored only in `chrome.storage.local` on your machine — nothing is hardcoded in the source, and nothing is sent anywhere except your own Apps Script deployment and (if configured) the Claude API directly from your browser.
