// CSV reading/writing, spreadsheet-compatible item import/export, and JSON import.
import { normaliseItem, normalisePriceChange } from './model.js';

export const CSV_HEADERS = ['Item', 'Cost', 'Every', 'Period', 'Category', 'Need/Want', 'My share', 'Active', 'Payment date', 'Trial ends', 'Notes', 'Link'];
const KEYS = ['name', 'cost', 'every', 'period', 'category', 'type', 'share', 'active', 'paymentDate', 'trialEnds', 'notes', 'link'];
const ALIASES = { item: 'name', name: 'name', cost: 'cost', every: 'every', period: 'period', category: 'category',
  'need/want': 'type', type: 'type', 'my share': 'share', share: 'share', active: 'active', 'payment date': 'paymentDate',
  paymentdate: 'paymentDate', 'trial ends': 'trialEnds', trialends: 'trialEnds', notes: 'notes', link: 'link', id: 'id' };

export function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export function itemsToCSV(items) {
  const lines = [CSV_HEADERS.join(',')];
  for (const it of items) {
    lines.push([it.name, it.cost, it.every, it.period, it.category, it.type, `${Math.round((it.share ?? 1) * 10000) / 100}%`,
      it.active === false ? 'No' : 'Yes', it.paymentDate, it.trialEnds, it.notes, it.link].map(esc).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

// Returns { items, errors: [{row, name, message}], total }. Row numbers match the spreadsheet (header = row 1).
// Throws if required columns are missing.
export function parseItemsCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('The file is empty');
  const cols = rows.shift().map((h) => ALIASES[h.trim().toLowerCase()] || null);
  const missing = ['name', 'cost', 'period'].filter((k) => !cols.includes(k));
  if (missing.length) {
    const label = { name: 'Item', cost: 'Cost', period: 'Period' };
    throw new Error('Missing column(s): ' + missing.map((k) => label[k]).join(', '));
  }
  const items = []; const errors = [];
  rows.forEach((r, i) => {
    const raw = {};
    cols.forEach((k, ci) => { if (k) raw[k] = r[ci]; });
    const res = normaliseItem(raw);
    if (res.item) items.push(res.item); else errors.push({ row: i + 2, name: String(raw.name || '').trim(), message: res.error });
  });
  return { items, errors, total: rows.length };
}

// Accepts a JSON backup ({items, priceChanges, settings}) or a bare array of items.
export function parseJSONImport(text) {
  const data = JSON.parse(String(text).replace(/^﻿/, ''));
  const rawItems = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(rawItems)) throw new Error('No items found in this file');
  const items = []; const errors = [];
  rawItems.forEach((r, i) => {
    const res = normaliseItem(r);
    if (res.item) items.push(res.item); else errors.push({ row: i + 1, name: String(r?.name || ''), message: res.error });
  });
  const priceChanges = Array.isArray(data.priceChanges) ? data.priceChanges.map(normalisePriceChange).filter(Boolean) : [];
  return { items, errors, total: rawItems.length, priceChanges, settings: Array.isArray(data) ? null : data.settings || null };
}

export function parseImportFile(text, filename) {
  const t = String(text).replace(/^﻿/, '').trim();
  return /\.json$/i.test(filename) || /^[[{]/.test(t) ? parseJSONImport(t) : { ...parseItemsCSV(t), priceChanges: [], settings: null };
}
