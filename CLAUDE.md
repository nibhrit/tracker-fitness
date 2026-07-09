# Nimo & Deep — Accountability App

## What this is
A two-person habit tracking web app hosted on GitHub Pages. Nimo and Deep use it daily to log workout consistency and fruit consumption. Both users access the same URL on their phones (added to home screen as a PWA).

## Repo structure
```
/
├── index.html       # The entire app — single file, no framework, no build step
├── icon.png         # Home screen / favicon icon
├── manifest.json    # PWA manifest for Android home screen install
├── worker/          # Cloudflare Worker — proxies food-photo scans to Claude API
│   ├── worker.js     # Holds ANTHROPIC_API_KEY as a secret; index.html never sees it
│   └── wrangler.toml
└── CLAUDE.md        # This file
```

## Stack
- **Frontend**: Vanilla HTML, CSS, JS — no framework, no bundler
- **Database**: Firebase Realtime Database (free tier) via REST API — no SDK
- **Hosting**: GitHub Pages (auto-deploys on push to main)
- **Food-scan backend**: Cloudflare Worker (`worker/`) — the one piece of server-side infra in this repo, needed only because a public static site can't hold a secret API key. Deployed separately from GitHub Pages.
- **Fonts**: DM Sans + DM Mono via Google Fonts

## How data is stored
All data lives in Firebase Realtime Database under this path structure:
```
logs/
  Nimo/
    2025-07-09/   ← ISO date key (YYYY-MM-DD)
      workout: true/false
      fruits: true/false
      type: "Strength" | "Cardio" | "HIIT" | "Yoga" | "Walk / Run" | "Sport" | "Other" | null
      duration: number (minutes) | null
      missReason: string | null   ← only set when workout is false
      ts: timestamp (ms)
  Deep/
    2025-07-09/
      ...same shape

foodlogs/
  Nimo/
    2025-07-09/
      -Nabc123...:        ← Firebase push ID (one per logged food item)
        name: string
        calories: number
        protein: number | null   ← grams; null if not estimated/entered
        carbs: number | null
        fat: number | null
        source: "scan" | "manual"
        ts: timestamp (ms)
  Deep/
    2025-07-09/
      ...same shape
```

Firebase is accessed via four REST helpers:
- `fbGet(path)` — GET request to `${FB_URL}/${path}.json`
- `fbSet(path, data)` — PUT request to `${FB_URL}/${path}.json` (overwrite)
- `fbPost(path, data)` — POST request; Firebase generates a unique key, used for food log entries (multiple per day)
- `fbDelete(path)` — DELETE request; used to remove a food log entry

The Firebase URL is entered by the user on first launch and saved to `localStorage` under key `nd_firebase_url`. On subsequent visits the config screen is skipped.

## Design system
Dark theme. CSS variables defined in `:root`:
- `--bg`: #0e0e10 (page background)
- `--surface`: #18181c (cards)
- `--surface2`: #222228 (inputs, secondary surfaces)
- `--border` / `--border2`: subtle white rgba borders
- `--text`: #f0f0f0
- `--muted`: #888 (secondary text)
- `--faint`: #444 (tertiary / disabled)
- `--nimo`: #a78bfa (purple — Nimo's colour)
- `--deep`: #34d399 (green — Deep's colour)
- `--yes`: #34d399 / `--no`: #f87171 / `--amber`: #fbbf24

## App structure
Single page with tab-based navigation. Four tabs:

### Overview tab (`#tab-overview`)
- Today's status cards side-by-side for Nimo and Deep
- 7-day streak dots below (coloured by what was logged: purple=workout, amber=fruits, green=both)
- Rendered by `renderOverview()` — makes Firebase calls for each person for today + last 7 days

### Log tab (`#tab-log`)
- Person switcher (Nimo / Deep)
- Workout card: Yes/No toggle → if Yes: type dropdown + duration input; if No: missed reason dropdown
- Fruits card: Yes/No toggle
- Save button — calls `saveLog()` which writes to Firebase
- State tracked in `woVal` (null/true/false) and `frVal` (null/true/false)

### Food tab (`#tab-food`)
- Person switcher (Nimo / Deep) — scopes the whole tab, same pattern as Log/History
- Today's total calories + macro breakdown (only shown if any macros were recorded)
- Two entry points, both funnel into the same confirm/edit modal so nothing saves un-reviewed:
  - **Scan** — `capture="environment"` file input opens the camera; the photo is downscaled client-side (`resizeImageToBase64()`, max 768px long edge, JPEG q=0.75) before upload, then POSTed to the Cloudflare Worker, which calls Claude (vision + structured output) and returns `{food_name, calories, protein_g, carbs_g, fat_g}`. Estimate pre-fills the modal for the user to correct.
  - **Manual entry** — opens the same modal blank
- Today's individual entries listed below, each deletable
- 7-day calorie bar chart (per-day totals for the selected person) — **no daily calorie goal or target is shown**, consistent with the no-scoring decision below
- Rendered by `renderFood()` + `renderFoodWeekChart()`

### History tab (`#tab-history`)
- Person switcher
- Last 30 days listed newest-first
- Each row shows date, workout badge (with type/duration if logged), fruits badge, and missed reason if applicable
- Rendered by `renderHistory()`

## Key functions
| Function | What it does |
|---|---|
| `initApp()` | Hides config screen, shows app, renders overview |
| `showTab(t)` | Switches active tab, triggers relevant render function |
| `selectPerson(p)` | Switches active person in Log tab, resets form state |
| `selectHist(p)` | Switches active person in History tab, re-renders |
| `setWo(v)` | Sets workout value, shows/hides extra fields |
| `setFr(v)` | Sets fruits value |
| `saveLog()` | Validates form, writes entry to Firebase, resets form |
| `renderOverview()` | Fetches today's data + last 7 days for both people, updates DOM |
| `renderHistory()` | Fetches last 30 days for current person, builds list |
| `selectFoodPerson(p)` | Switches active person in Food tab, re-renders |
| `renderFood()` | Fetches today's food entries for current person, renders total + list, triggers week chart |
| `renderFoodWeekChart()` | Fetches last 7 days of food entries, renders per-day calorie bar chart |
| `triggerScan()` | Opens the native camera/file picker |
| `onPhotoSelected(e)` | Resizes the photo, POSTs to the Worker, pre-fills the confirm modal with the AI estimate |
| `resizeImageToBase64(file, maxDim)` | Canvas-based client-side downscale + JPEG encode before upload |
| `openFoodModal(mode)` / `closeFoodModal()` | Opens/closes the add/confirm modal (`mode` is `"scan"` or `"manual"`) |
| `saveFoodEntry()` | Validates the modal form, writes to `foodlogs/{person}/{date}` via `fbPost` |
| `deleteFoodEntry(date, id)` | Removes one food log entry via `fbDelete` |
| `showToast(msg)` | Shows bottom toast notification for 2.5s |
| `last7()` / `last30()` | Returns array of ISO date strings going back 7/30 days |

## Decisions made / things to preserve
- **No scoring/competition features** — deliberately removed to avoid negativity between the two users. This also means **no calorie goals/targets** — the Food tab shows totals and trends only, never a "you're under/over" comparison
- **Single `index.html`** — keep it this way; no build step, no node_modules, deploys instantly via GitHub Pages. The `worker/` directory is the one exception, and it exists solely because a public static site cannot hold a secret API key
- **Firebase REST only** — no Firebase SDK to keep the file self-contained
- **AI photo scan never auto-saves** — the Worker's estimate always lands in the same editable confirm modal as manual entry; nothing is written to Firebase until the user taps Save
- **Photos are never stored** — only the resized image is sent to the Worker for one-shot analysis, then discarded; the identified nutrition data is what's saved, not the image itself
- **Max-width 480px** — mobile-first, centered on desktop
- **Per-person colour theming** — Nimo = purple (`--nimo`), Deep = green (`--deep`). Buttons and accents change colour based on selected person

## Deploy workflow
```bash
git add .
git commit -m "your message"
git push
```
GitHub Pages auto-deploys `index.html`. Changes are live within ~30 seconds.

The Worker deploys separately and only needs re-deploying when `worker/worker.js` changes:
```bash
cd worker
wrangler deploy
```
One-time setup after first deploy:
```bash
wrangler secret put ANTHROPIC_API_KEY   # your Claude API key
wrangler secret put APP_SECRET          # any random string
```
Then in `index.html`, set `SCAN_WORKER_URL` to the deployed Worker URL and `SCAN_APP_SECRET` to the same string used for `APP_SECRET` above — these two must match or scans return 401.

## Future improvements (not yet built)
- Push notifications / reminders
- Longer history view (beyond 30 days)
- Notes field on workout log
- Streak counter (consecutive days)
- Barcode/text search fallback for packaged foods without a photo
