# LinkedIn Contact Tagger — setup

Two parts: a Google Sheet + Apps Script backend, and the Chrome extension itself.

## 1. Create the Google Sheet backend

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it something like "LinkedIn Contact Tagger".
2. In the menu, open **Extensions > Apps Script**. This opens the script editor bound to your sheet.
3. Delete the placeholder `myFunction() {}` code, and paste in the full contents of [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
4. Save the project (⌘S / Ctrl+S). Give it a name like "LinkedIn Contact Tagger backend" when prompted.
5. Set your secret token — this is the shared password the extension sends with every request:
   - In the left sidebar, click **Project Settings** (the gear icon).
   - Scroll to **Script Properties** and click **Add script property**.
   - Property: `SECRET_TOKEN`. Value: any long random string you make up (e.g. generate one at random — treat it like a password). Save.
6. Deploy as a web app:
   - Back in the editor, click **Deploy > New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Description: anything, e.g. "v1".
   - **Execute as:** Me.
   - **Who has access:** Anyone. (This does *not* mean anyone can read your data — every request still needs your secret token, which only you have. It's required because the extension calls this URL without a Google login.)
   - Click **Deploy**, then **Authorize access** and approve the permissions prompt (it needs to edit the spreadsheet).
   - Copy the **Web app URL** it gives you (ends in `/exec`). You'll paste this into the extension.
7. The sheet will get a "Connections" tab with headers the first time you save a profile from the extension — you don't need to create it by hand.

**Updating to rename tags and families:** renaming a tag or a tag family in the **Tag manager** needs the `renameTag` and `renameFamily` actions in `Code.gs` (added in November 2026). If your deployment is older, paste the latest `Code.gs` over yours and re-deploy as below. Until you do, renaming shows an "out of date" error and nothing changes; colors work either way.

**Re-deploying after edits:** if you ever change `Code.gs`, use **Deploy > Manage deployments > Edit (pencil) > New version** so the same `/exec` URL picks up your changes.

## 2. Install the Chrome extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Pin the extension from the puzzle-piece menu so its icon stays visible in the toolbar.

## 3. Connect the extension to your Sheet

1. Click the extension's toolbar icon to open the side panel.
2. Click the gear icon (top right) to open Settings.
3. Paste the **Web app URL** from step 1.6 and the **Secret token** you set in step 1.5.
4. Click **Save settings**.

## 4. (Optional) Enable AI status suggestions

The "Suggest" button next to Status uses the Claude API to propose Keep / Unsure / Remove based on the visible text of the profile page you're looking at plus your note. It never runs automatically — only when you click it.

1. Get an API key at [console.anthropic.com](https://console.anthropic.com) (Settings → API Keys).
2. Paste it into Settings → **Claude API key**. Leave it blank to skip this feature — clicking **Suggest** without a key just shows a reminder to add one in Settings.

The key is stored only in `chrome.storage.local` and sent directly from your browser to `api.anthropic.com` — there's no backend in between. Anthropic's SDK normally blocks browser-based calls by default because it means the key lives in client-side code where anyone with access to the browser could read it; that's an acceptable tradeoff for a single-user local extension, but don't reuse this key anywhere it could be exposed more broadly.

## 5. Use it

Open any `linkedin.com/in/...` profile, click the toolbar icon, add tags/a note/a status, and click **Save**. It saves instantly to `chrome.storage.local` on your machine and syncs to your Sheet in the background.

Your token and Web App URL are stored only in `chrome.storage.local` on your machine — nothing is hardcoded in the extension source.
