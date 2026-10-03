# Budget Tracker

A tiny offline-capable PWA (plain HTML, CSS and vanilla JS — no build step, no backend) that shows what your recurring costs add up to per week, fortnight, month, quarter and year. Data stays in your browser's `localStorage`.

## How the calculations work

Each item has a `cost`, an `every` (whole number, default 1) and a `period` (Week, Fortnight, Month, Quarter, Year).

```
yearly      = cost × paymentsPerYear[period] / every
weekly      = yearly / 52
fortnightly = yearly / 26
monthly     = yearly / 12
quarterly   = yearly / 4
```

`paymentsPerYear` is Week 52, Fortnight 26, Month 12, Quarter 4, Year 1 (constants at the top of `app.js`). Example: $42.34 every 7 weeks → 42.34 × 52 / 7 = $314.53 a year. Values are never rounded in calculations, only when displayed (AUD via `Intl.NumberFormat`).

Open `tests.html` to run the self-check: it verifies the seed data totals ($365.18 / $730.37 / $1,582.46 / $4,747.39 / $18,989.55) and fails loudly if they drift.

## Adding items

Items tab → the **+** button → enter name, cost, "every" and period. A live preview shows all five conversions as you type. Tap an item to edit it, or the bin icon to delete (with confirmation). The first run is pre-loaded with example data; use Settings → *Clear all data* to start empty, or *Load example data* to bring it back.

## Export / import

Settings → **Export JSON** or **Export CSV** downloads your items. **Import** accepts either format (CSV columns: `id,name,cost,every,period`; `id` may be blank). You then choose **Merge** (adds items, updating any with a matching id) or **Replace** (swaps everything). Invalid rows are skipped and counted.

## Install on your phone

- **iPhone/iPad (Safari):** open the site → Share → **Add to Home Screen**.
- **Android (Chrome):** open the site → menu (⋮) → **Install app** (or *Add to Home screen*).

After the first visit the app works fully offline.

## Hosting on GitHub Pages

Repo Settings → Pages → Deploy from branch → `main` / `/ (root)`. All paths are relative, so it works under `/<repo-name>/`. When you change cached files, bump `CACHE` in `service-worker.js` so installed copies update.

`scripts/make-icons.js` regenerates the PNG icons (`node scripts/make-icons.js`).
