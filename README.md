# Budget Tracker

An offline-capable PWA (plain HTML, CSS and vanilla JS ES modules; no build step, no backend, no external requests) that shows what your recurring costs add up to per week, fortnight, month, quarter and year, against your income, with due dates, alerts, a sinking fund and a 12-month cash-out forecast. It is the phone version of `Budget_Tracker.xlsx`. All data stays in your browser's `localStorage`.

## How the calculations work

Each item has a `cost` (one payment), `every` (whole number), `period` (Week / Fortnight / Month / Quarter / Year) and `share` (0–1, your part if split).

```
yearly      = cost × paymentsPerYear[period] / every × share      (Week 52, Fortnight 26, Month 12, Quarter 4, Year 1)
weekly = yearly/52   fortnightly = yearly/26   monthly = yearly/12   quarterly = yearly/4
billAmount  = cost × share                                        (one payment)
```

- Totals, categories and need/want breakdowns count **active** items only. Paused items keep their own figures (greyed out) but are excluded from everything else; "paused saves/year" is their yearly total.
- Income per year = `amount × paymentsPerYear[period] / every`. Left over and % of income spent appear once an income is set.
- **Next due date:** from any payment date. Week/Fortnight items step forward by `7 or 14 × every` days. Month/Quarter/Year items add months to the *original* date (never the previous result) and clamp to month end, so 31 Jan monthly goes 28 Feb, 31 Mar, 30 Apr.
- **Alerts** (active items): "Trial ends soon" if the trial ends within *alert days* (it wins), otherwise "Due soon" if the next due date is within alert days.
- **Cash needed** in the next 7/14/30 days counts every payment in the window (weekly items can pay more than once).
- **12-month forecast:** 12 rolling windows starting today. Dated items count their actual payments × `billAmount`; undated items contribute their monthly figure; paused items contribute nothing.
- **Sinking fund:** an item is a lump-sum bill if `every × days-in-period ≥ lump-sum threshold` (default 60 days). Set-aside per fortnight is its fortnightly figure; *should have saved* = `min(bill, max(0, bill − fortnightly × daysUntil / 14))`.
- **Price rises** within the look-back window get a badge; yearly impact = `change × (item yearly / item cost)`.
- Nothing is rounded in calculations, only for display (AUD, en-AU).

## Using it

- **Add items:** Items tab → **+**. Name, cost, every, period, category, need/want, share %, active, payment date, trial end, notes, link. A live preview shows the five cost figures and the next due date.
- **Payment dates:** enter *any* date the item was or will be paid; the app rolls it forward. Dates unlock due dates, alerts, cash-needed and exact forecasts.
- **Pausing:** the Pause button on an item row. **What if I cancel?** shows the saving per week/fortnight/month/quarter/year.
- **Sharing:** set "My share" below 100% and every figure uses only your part.
- **Categories:** Settings → Categories. Renaming updates the items using it.
- **Price history:** log a change (optionally updating the item's cost in one go); rises and falls show change $, %, and yearly impact.

## Export / import (and the spreadsheet)

- **JSON** is a full backup (items, price changes, settings). **CSV** uses exactly these headers: `Item, Cost, Every, Period, Category, Need/Want, My share, Active, Payment date, Trial ends, Notes, Link`.
- Import accepts JSON or CSV, with **Merge** (match by name or id) or **Replace**. Dates can be `YYYY-MM-DD`, `D/M/YYYY` (Australian order) or `D MMM YYYY`; Active is Yes/No; My share is `50%` or `0.5`. Rows that fail validation are listed (with their row numbers) before you confirm; none are dropped silently.
- **Spreadsheet round trip:** paste/save your sheet's table as CSV with those headers to import; export CSV to open it back in Excel.
- **Bank statement import:** Settings → *Find recurring charges*. Pick your bank's CSV, confirm the date/description/amount columns (remembered for next time), and tick the suggestions to add. Needs 3+ charges with the same cleaned-up description, evenly spaced (±3 days) at a weekly…yearly interval, amounts within 10%. Everything happens locally.

## Reminders on a phone

A static site cannot send background push notifications (and iOS can't schedule local ones without a server). So: alerts show as a banner and Dashboard tab badge whenever the app is open, and the optional **Notify me** button shows a notification for current alerts each time you open it. For real reminders use **Settings → Add upcoming payments to my calendar (.ics)**: it makes one event per payment for the next 12 months with a reminder *alert-days* before each. Open the file on your phone to add them to your calendar.

## Install on a phone

- **iPhone/iPad (Safari):** open the site → Share → **Add to Home Screen**.
- **Android (Chrome):** open the site → menu (⋮) → **Install app**.

After the first visit it works fully offline. When a new version is deployed you'll see an "update available — Reload" bar. (A very old installed copy may need the app to be fully closed and reopened once to pick up the first update.)

## Tests

Open `tests.html` (green/red), or run `node scripts/run-tests.mjs`. Both run the same suite in `js/tests-core.js` with today fixed at 2026-10-04, covering the seed and spreadsheet fixtures, month-end/leap-year date rolling, CSV round trip, bank detection, calendar export and corrupted storage.

## Layout & deployment

`index.html`, `styles.css`, `app.js` (UI), `js/` (constants, dates, model, calc, storage, csv, bank, ics, dom, tests-core), `manifest.webmanifest`, `service-worker.js`, `icons/`. All paths are relative, so it works under `/<repo-name>/`. Hosted on GitHub Pages from `main` / root. When you change cached files, bump `CACHE` in `service-worker.js` and add any new files to its `SHELL` list. `node scripts/make-icons.js` regenerates the icons.
