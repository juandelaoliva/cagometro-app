# Cagómetro · PWA

Installable web app (PWA) that mirrors the Telegram bot: add cacas, see the group
ranking, celebrate milestones. **Same Firebase data as the bot** (once wired to the API).

## Status
- ✅ Front-end MVP, mobile-first, installable, light editorial theme.
- 🧪 Running on **mock data** (`api.js`, persisted in `localStorage`). Fully clickable.
- ⏳ To go live: build the Pi API and flip the switch (below).

## Files (all static — no build step)
- `index.html` · `styles.css` · `app.js` — the app
- `api.js` — **the only data layer**; mock now, real API later
- `manifest.webmanifest` · `sw.js` · `icon.svg` — PWA install + offline shell

## Deploy (GitHub Pages)
1. Create a public repo `cagometro-app`.
2. Upload all these files (drag them into **Add file → Upload files**).
3. **Settings → Pages → Deploy from branch → main / (root)**.
4. Live at `https://juandelaoliva.github.io/cagometro-app/` → open on your phone → "Add to Home Screen".

> Tip: replace `icon.svg` with a 512×512 PNG later for the crispest iOS home-screen icon.

## Going live (later, when the Pi API exists)
In `api.js`, set:
```js
const USE_MOCK = false;
const BASE_URL = "https://raspberry.<tu-tailnet>.ts.net";   // the Pi API via Tailscale Funnel
```
Nothing else changes — the UI only talks to `api.js`.

### API contract the Pi must implement
| Method | Endpoint | Returns |
|---|---|---|
| GET  | `/api/me`       | `{ username, name, color, count, rank, totalUsers, nextMilestone, streak }` |
| GET  | `/api/ranking`  | `[ { username, name, color, count } ]` (desc) |
| GET  | `/api/activity` | `[ { id, type, username, name, color, text, ts } ]` |
| GET  | `/api/stats`    | `{ today, week, month, total, streak, bestDay, byWeekday[7], byHour[24] }` |
| POST | `/api/caca`     | `{ count, rank, milestone\|null }` |

Auth: the bot magic-link establishes a session (cookie/token) that identifies the
Telegram user; the API maps that to `users/<grupo>/counter/<usuario>` in Firebase.
