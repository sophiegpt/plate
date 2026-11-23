# Plate: calorie and macro coach

A Home Screen web app for iPhone. Snap or type what you eat. Claude identifies the food, estimates calories, protein, carbs and fat, tells you what's left for the day, and suggests better options when something doesn't fit. Nothing is logged until you confirm it.

- **Targets** come from a photo of your Evolt 360 (or any body-composition) scan.
- **Garmin** adds part of a big training day's calories to your target (optional).
- **Accountability**: tough-love coaching, an end-of-day recap, streaks, weekly trends, and weight and scan tracking.

Your log stays on your phone. Photos and descriptions go to Anthropic with your own API key, only to be analyzed.

## 1. Get an Anthropic API key (5 minutes, once)

1. Sign in at [platform.claude.com](https://platform.claude.com) with a **personal** account, not a work one. A Claude.ai subscription doesn't include API credit.
2. Add some credit under **Billing**, then set a monthly limit under **Settings → Limits**.
3. Create a key under **Settings → API keys**. Keep it somewhere safe, like your password manager. You'll paste it into Plate on your phone.

Rough cost: 10–15¢ per photo and 5–10¢ per typed entry on Fable 5.2, about half that on Opus 5.5. Settings in the app shows an estimate for the month.

## 2. Put it online with GitHub Pages (about 10 minutes, once)

1. On github.com, create a **new public repository** named `plate`. Pages is free for public repositories; only this code is public, never your data or keys.
2. Upload everything in this folder (`index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll` and the `css`, `js` and `icons` folders). The `relay` and `tools` folders can go up too; the app doesn't use them.
3. In the repository, go to **Settings → Pages → Deploy from a branch**, choose **main** and **/ (root)**, then **Save**.
4. After a minute or two it's live at `https://YOUR-USERNAME.github.io/plate/`.

## 3. Add it to your iPhone Home Screen

1. Open the address in **Safari**, tap **Share**, then **Add to Home Screen** (leave **Open as Web App** on).
2. Open Plate **from the new icon** and set it up there. The Home Screen app keeps its own storage, separate from Safari, so a key entered in Safari won't carry over.
3. Setup walks you through it: paste your API key, snap your Evolt scan (check the numbers Claude read, pick your goal and activity), then optionally connect Garmin.

## 4. Connect Garmin (optional, about 15 minutes, once)

Garmin doesn't accept calls from web pages, so Plate reads your calories through a tiny relay that you own: a free Cloudflare Worker that holds your Garmin key.

1. **Garmin key.** Sign in to Garmin Connect on the web, open [Personal API Key](https://connect.garmin.com/app/settings/personalApiToken), choose **Create Key**, accept the terms, pick **1 year**, and copy the key. Garmin shows it only once.
2. **Passcode.** In Plate, go to **Settings → Garmin relay** and tap **Make a new passcode**. It's copied for you; keep it for step 4.
3. **Cloudflare.** Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com). Then, in a terminal on your computer:

   ```
   cd plate/relay
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GARMIN_API_KEY
   npx wrangler secret put RELAY_PASSCODE
   ```

   `deploy` prints your relay's address, like `https://plate-relay.yourname.workers.dev`. Each `secret put` asks you to paste a value: the Garmin key, then the passcode. If Plate isn't hosted at `sophiegpt.github.io`, change `ALLOWED_ORIGINS` in `relay/wrangler.toml` first.
4. **Connect.** Back in Plate, paste the relay's address and the passcode into **Settings → Garmin relay**, then tap **Save and test**. It pulls your last 4 weeks straight away.

When the Garmin key expires (Garmin emails you a week before), create a new one and run `npx wrangler secret put GARMIN_API_KEY` again.

`tools/garmin-test.mjs` is a one-off check that your key returns calories: `node --use-system-ca tools/garmin-test.mjs`.

## Updating the app

1. Upload the changed files to the same repository.
2. In `sw.js`, raise `VERSION` (for example `1.0.0` → `1.0.1`). Otherwise phones keep the old copy.
3. Next time you open Plate with signal, it shows **A new version of Plate is ready → Update**.

## Good to know

- **Back up now and then.** Settings → Export backup saves it to Files, Notes or AirDrop. Deleting the Home Screen icon deletes the app's data. Backups never include your API key, the relay passcode or photos.
- **Offline.** The app opens and shows your log with no signal. Analyzing food needs a connection.
- **Leaving mid-analysis.** If you switch apps while Claude is working, iOS may cut the request off; tap **Try again**.
- **Estimates are estimates.** Portion size is the biggest source of error. Tell Claude when it's off ("only ate half"), or edit the numbers. Labels and official restaurant data are used exactly.
- **Calories burned.** Plate never adds your watch's calories back one for one: your activity factor already covers a normal week. After 2–3 weeks of logging and a few weigh-ins, the Body tab shows what you really burn and offers to update your target.

## Where things live (for edits)

- `js/ai.js`: everything sent to Claude (prompts, the `record_food` tool schema, models and prices)
- `js/nutrition.js`: targets, Garmin flex, streaks, ranges and the adaptive estimate
- `js/garmin.js` and `relay/worker.js`: the Garmin connection
- `js/views/*.js`: the screens (`log.js` is the composer and confirm card)
- `js/vendor/anthropic.js`: the official Anthropic TypeScript SDK 1.12.0, bundled for the browser (Apache-2.0, licence alongside)
- `tools/make-icons.mjs`: redraws the icons

## Testing locally

Serve the folder and open `http://localhost:8766/?mock=1`. Mock mode answers with canned results, so you can click through every screen without an API key. The service worker is off on localhost unless you add `?sw=1`.
