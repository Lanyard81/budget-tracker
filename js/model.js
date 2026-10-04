// Data model: validation/normalisation of items, price changes and settings; seed data; merging.
import { PERIODS, TYPES, SEED_ROWS, DEFAULT_SETTINGS, DEFAULT_CATEGORIES } from './constants.js';
import { parseFlexibleDate } from './dates.js';

let idCounter = 0;
export function newId() {
  return Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
}

export function parseMoney(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
export function normalisePeriod(text) {
  const t = String(text || '').trim().toLowerCase().replace(/s$/, '').replace(/ly$/, '');
  return { week: 'Week', fortnight: 'Fortnight', month: 'Month', quarter: 'Quarter', year: 'Year', annual: 'Year' }[t] || null;
}
// "50%", "0.5" or 50 -> 0.5. Empty -> 1 (100%). Invalid or out of range -> NaN.
export function parseShare(v) {
  if (v === undefined || v === null || String(v).trim() === '') return 1;
  let n;
  if (typeof v === 'number') n = v > 1 ? v / 100 : v;
  else {
    const t = String(v).trim();
    n = Number(t.replace(/%$/, '').replace(/,/g, ''));
    if (t.endsWith('%')) n /= 100; else if (n > 1) n /= 100;
  }
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : NaN;
}
function parseBool(v, dflt) {
  if (v === undefined || v === null || String(v).trim() === '') return dflt;
  if (typeof v === 'boolean') return v;
  const t = String(v).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(t)) return true;
  if (['no', 'n', 'false', '0'].includes(t)) return false;
  return null;
}
function parseDateField(v) {
  if (v === undefined || v === null || String(v).trim() === '') return '';
  return parseFlexibleDate(v); // null if invalid
}

// Returns { item } or { error } where error is a human-readable reason.
export function normaliseItem(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Not an item' };
  const name = String(raw.name ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const cost = parseMoney(raw.cost);
  if (!(cost > 0)) return { error: 'Cost must be greater than 0' };
  const everyRaw = raw.every === undefined || raw.every === null || String(raw.every).trim() === '' ? 1 : Number(raw.every);
  if (!Number.isInteger(everyRaw) || everyRaw < 1) return { error: 'Every must be a whole number, 1 or more' };
  const period = normalisePeriod(raw.period);
  if (!period) return { error: 'Period must be Week, Fortnight, Month, Quarter or Year' };
  const typeText = String(raw.type ?? '').trim();
  const type = TYPES.find((t) => t.toLowerCase() === typeText.toLowerCase()) || '';
  if (typeText && !type) return { error: 'Need/Want must be Need, Want or blank' };
  const share = parseShare(raw.share);
  if (Number.isNaN(share)) return { error: 'My share must be 0–100%' };
  const active = parseBool(raw.active, true);
  if (active === null) return { error: 'Active must be Yes or No' };
  const paymentDate = parseDateField(raw.paymentDate);
  if (paymentDate === null) return { error: 'Payment date is not a valid date' };
  const trialEnds = parseDateField(raw.trialEnds);
  if (trialEnds === null) return { error: 'Trial ends is not a valid date' };
  return {
    item: {
      id: raw.id ? String(raw.id) : newId(), name: name.slice(0, 80), cost, every: everyRaw, period,
      category: String(raw.category ?? '').trim(), type, share, active, paymentDate, trialEnds,
      notes: String(raw.notes ?? '').trim().slice(0, 1000), link: String(raw.link ?? '').trim().slice(0, 500),
    },
  };
}

export function normalisePriceChange(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = parseFlexibleDate(raw.date);
  const oldCost = parseMoney(raw.oldCost);
  const newCost = parseMoney(raw.newCost);
  if (!date || !raw.itemId || !(oldCost > 0) || !(newCost > 0)) return null;
  return { id: raw.id ? String(raw.id) : newId(), date, itemId: String(raw.itemId), oldCost, newCost };
}

const clampInt = (v, lo, dflt) => { const n = Number(v); return Number.isInteger(n) && n >= lo ? n : dflt; };
export function normaliseSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const inc = r.income && typeof r.income === 'object' ? r.income : {};
  const amount = parseMoney(inc.amount);
  const cats = Array.isArray(r.categories) && r.categories.length === 10 && r.categories.every((c) => typeof c === 'string' && c.trim())
    ? r.categories.map((c) => c.trim()) : DEFAULT_CATEGORIES.slice();
  const bm = r.bankMapping;
  return {
    income: {
      amount: amount > 0 ? amount : 0, every: clampInt(inc.every, 1, 1),
      period: normalisePeriod(inc.period) || d.income.period,
    },
    alertDays: clampInt(r.alertDays, 0, d.alertDays),
    lumpDays: clampInt(r.lumpDays, 1, d.lumpDays),
    lookbackDays: clampInt(r.lookbackDays, 1, d.lookbackDays),
    categories: cats,
    theme: ['auto', 'light', 'dark'].includes(r.theme) ? r.theme : 'auto',
    view: PERIODS.includes(r.view) ? r.view : d.view,
    notify: r.notify === true,
    bankMapping: bm && typeof bm === 'object' ? { date: String(bm.date || ''), desc: String(bm.desc || ''), amount: String(bm.amount || '') } : null,
  };
}

export function seedItems() {
  return SEED_ROWS.map(([name, cost, every, period, category, type]) =>
    normaliseItem({ name, cost, every, period, category, type }).item);
}

// Merge incoming items into existing: match by id, then by name (case-insensitive). Mutates `existing`.
export function mergeItems(existing, incoming) {
  let added = 0; let updated = 0;
  for (const it of incoming) {
    const hit = existing.find((x) => x.id === it.id) || existing.find((x) => x.name.toLowerCase() === it.name.toLowerCase());
    if (hit) { Object.assign(hit, it, { id: hit.id }); updated++; } else { existing.push(it); added++; }
  }
  return { added, updated };
}
