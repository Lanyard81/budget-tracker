// Bank statement import: runs entirely locally. Detect columns, read transactions, find recurring charges.
import { parseFlexibleDate, parseISO } from './dates.js';
import { parseMoney } from './model.js';

// Target spacing in days for each period, and how far (+/- days) charges may drift.
const SPACING = [['Week', 7], ['Fortnight', 14], ['Month', 30.4375], ['Quarter', 91.3125], ['Year', 365.25]];
const TOLERANCE_DAYS = 3;
const AMOUNT_TOLERANCE = 0.10;
const MIN_CHARGES = 3;

// Auto-detect which header is the date / description / amount (returns column indexes, -1 if not found).
export function detectColumns(headers) {
  const find = (re) => headers.findIndex((h) => re.test(String(h).trim().toLowerCase()));
  let amount = find(/^(amount|value|transaction amount)$/);
  if (amount < 0) amount = find(/amount|debit|value/);
  return { date: find(/date/), desc: find(/desc|narrat|detail|particular|merchant|payee|memo|reference/), amount };
}

// Lowercase, drop digits/card/reference noise and punctuation so "NETFLIX.COM 8812 SYDNEY" groups with other months.
export function normaliseDescription(s) {
  return String(s || '').toLowerCase()
    .replace(/x{2,}\d+/g, ' ').replace(/\d+/g, ' ')
    .replace(/\b(visa|mastercard|eftpos|debit|credit|card|purchase|pos|payment|direct|dd|ref|receipt|pending|value|date|aus|au|paypal|www|com|pty|ltd)\b/g, ' ')
    .replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// rows: parsed CSV rows excluding the header. mapping: {date, desc, amount} column indexes.
// Spending is read as absolute amounts; if the file has negative amounts, positive ones (credits) are ignored.
export function readTransactions(rows, mapping) {
  const tx = [];
  for (const r of rows) {
    const date = parseFlexibleDate(r[mapping.date]);
    const amount = parseMoney(r[mapping.amount]);
    const desc = String(r[mapping.desc] ?? '').trim();
    if (date && Number.isFinite(amount) && amount !== 0 && desc) tx.push({ date, desc, amount });
  }
  const hasNegatives = tx.some((t) => t.amount < 0);
  return tx.filter((t) => !hasNegatives || t.amount < 0).map((t) => ({ ...t, amount: Math.abs(t.amount) }));
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function findRecurring(transactions, existingItems = []) {
  const groups = new Map();
  for (const t of transactions) {
    const key = normaliseDescription(t.desc);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const existing = existingItems.map((i) => normaliseDescription(i.name) || i.name.toLowerCase());
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < MIN_CHARGES) continue;
    if (existing.some((n) => n && (n === key || (n.length >= 3 && (key.includes(n) || n.includes(key)))))) continue;
    list.sort((a, b) => parseISO(a.date) - parseISO(b.date));
    const gaps = list.slice(1).map((t, i) => parseISO(t.date) - parseISO(list[i].date));
    const period = SPACING.find(([, target]) => gaps.every((g) => Math.abs(g - target) <= TOLERANCE_DAYS));
    if (!period) continue;
    const med = median(list.map((t) => t.amount));
    if (!list.every((t) => Math.abs(t.amount - med) / med <= AMOUNT_TOLERANCE)) continue;
    out.push({
      key, name: titleCase(key) || list[0].desc, cost: Math.round(med * 100) / 100, every: 1, period: period[0],
      paymentDate: list[list.length - 1].date, count: list.length,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
