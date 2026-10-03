/* Budget Tracker — vanilla JS, no dependencies.
   Sections: constants, state, calculations, storage, import/export, rendering, event handlers. */
'use strict';

/* ============================== CONSTANTS ============================== */
const STORAGE_KEY = 'budgetTracker:v1';
const SCHEMA_VERSION = 1;

// Payments per year for each billing period (single source of truth).
const PAYMENTS_PER_YEAR = { Week: 52, Fortnight: 26, Month: 12, Quarter: 4, Year: 1 };
const PERIODS = Object.keys(PAYMENTS_PER_YEAR);
const PERIOD_LABELS = { Week: 'Weekly', Fortnight: 'Fortnightly', Month: 'Monthly', Quarter: 'Quarterly', Year: 'Yearly' };

const SEED_ITEMS = [
  ['Amazon Prime', 79, 1, 'Year'], ['Netflix', 37.98, 1, 'Month'], ['Disney+', 24.99, 1, 'Month'],
  ['Stan', 23.99, 1, 'Month'], ['HBO', 15.99, 1, 'Month'], ['Fred Walks', 200, 1, 'Fortnight'],
  ['Fred Insurance', 78.49, 1, 'Fortnight'], ['Grass', 51.68, 1, 'Fortnight'],
  ['HealthyPetPlus', 23.08, 1, 'Fortnight'], ['Dermaveen', 32, 3, 'Month'],
  ['Catfood', 71.98, 1, 'Fortnight'], ['Fah', 140, 1, 'Fortnight'], ['TP', 11.63, 3, 'Month'],
  ['Kleenex', 19.84, 3, 'Month'], ['Catfood 2', 71.98, 1, 'Month'], ['Freds Pills', 42.34, 7, 'Week'],
  ['Lyka', 178.5, 6, 'Week'],
];
const seedItems = () => SEED_ITEMS.map(([name, cost, every, period]) => ({ id: newId(), name, cost, every, period }));

const CHART_COLORS = ['#1f4e9c', '#3b82c4', '#0e7c86', '#7a5cc9', '#c2410c', '#b45309', '#4d7c0f', '#64748b'];

/* ================================ STATE ================================ */
const state = {
  items: [],
  settings: { theme: 'auto', view: 'Month' },
  tab: 'dashboard',
  search: '',
  sort: 'name',
  editingId: null,
};

/* ============================ CALCULATIONS ============================= */
// All maths is unrounded; rounding happens only in formatMoney().
// yearly = cost * paymentsPerYear[period] / every; other periods divide yearly by PAYMENTS_PER_YEAR[view].
const yearlyCost = (item) => (item.cost * PAYMENTS_PER_YEAR[item.period]) / item.every;
const costForPeriod = (item, period) => yearlyCost(item) / PAYMENTS_PER_YEAR[period];
const totalYearly = (items) => items.reduce((sum, it) => sum + yearlyCost(it), 0);
function totalsByPeriod(items) {
  const y = totalYearly(items);
  const out = {};
  PERIODS.forEach((p) => { out[p] = y / PAYMENTS_PER_YEAR[p]; });
  return out;
}

/* ============================== UTILITIES ============================== */
const moneyFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const formatMoney = (n) => moneyFmt.format(n);
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
const frequencyLabel = (it) => {
  const unit = it.period.toLowerCase();
  return `${formatMoney(it.cost)} every ${it.every === 1 ? unit : it.every + ' ' + unit + 's'}`;
};
function parseCost(text) {
  const n = Number(String(text).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
function normalisePeriod(text) {
  const t = String(text || '').trim().toLowerCase().replace(/s$/, '').replace(/ly$/, '');
  const map = { week: 'Week', fortnight: 'Fortnight', month: 'Month', quarter: 'Quarter', year: 'Year', annual: 'Year' };
  return map[t] || null;
}
// Validate and normalise a raw item; returns item or null.
function sanitiseItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? '').trim();
  const cost = typeof raw.cost === 'number' ? raw.cost : parseCost(raw.cost);
  const every = Number(raw.every ?? 1);
  const period = normalisePeriod(raw.period);
  if (!name || !(cost > 0) || !Number.isInteger(every) || every < 1 || !period) return null;
  return { id: raw.id ? String(raw.id) : newId(), name: name.slice(0, 80), cost, every, period };
}

/* =============================== STORAGE =============================== */
// Migration hook: upgrade older saved shapes to SCHEMA_VERSION.
function migrate(data) {
  const v = Number(data.schema) || 0;
  // if (v < 2) { ...transform data...; }   <- add future steps here
  if (v > SCHEMA_VERSION) console.warn('Data is from a newer app version');
  data.schema = SCHEMA_VERSION;
  return data;
}
function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage blocked */ }
  if (raw === null) { state.items = seedItems(); saveState(); return; }
  try {
    const data = migrate(JSON.parse(raw));
    state.items = (Array.isArray(data.items) ? data.items : []).map(sanitiseItem).filter(Boolean);
    const s = data.settings || {};
    if (['auto', 'light', 'dark'].includes(s.theme)) state.settings.theme = s.theme;
    if (PERIODS.includes(s.view)) state.settings.view = s.view;
  } catch (e) {
    console.warn('Corrupted storage; starting empty', e);
    try { localStorage.setItem(STORAGE_KEY + ':corrupt', raw); } catch (_) { /* ignore */ }
    state.items = [];
    toast('Saved data was unreadable and has been reset.');
  }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: SCHEMA_VERSION, items: state.items, settings: state.settings }));
  } catch (e) { toast('Could not save (storage full or blocked).'); }
}

/* ============================ IMPORT / EXPORT ========================== */
const CSV_HEADER = ['id', 'name', 'cost', 'every', 'period'];
function toCSV(items) {
  const esc = (v) => { const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [CSV_HEADER.join(',')].concat(items.map((it) => CSV_HEADER.map((k) => esc(it[k])).join(','))).join('\r\n');
}
function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
// Returns { items, skipped } from file text of either format.
function parseImport(text, filename) {
  const raws = [];
  const t = text.replace(/^﻿/, '').trim();
  if (/\.json$/i.test(filename) || /^[\[{]/.test(t)) {
    const data = JSON.parse(t);
    raws.push(...(Array.isArray(data) ? data : data.items || []));
  } else {
    const rows = parseCSV(t);
    const head = rows.shift().map((x) => x.trim().toLowerCase());
    rows.forEach((r) => { const o = {}; head.forEach((k, i) => { o[k] = r[i]; }); raws.push(o); });
  }
  const items = raws.map(sanitiseItem).filter(Boolean);
  return { items, skipped: raws.length - items.length };
}
function download(filename, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================== RENDERING ============================== */
// h(tag, attrs, ...children): builds DOM safely; strings become text nodes (never HTML).
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  children.flat().forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}
const $ = (sel) => document.querySelector(sel);
const svgEl = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
};

function render() {
  renderTabs();
  renderViewToggles();
  renderDashboard();
  renderItems();
  renderSettings();
}

function renderTabs() {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + state.tab; });
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#fab').hidden = state.tab !== 'items';
}

function renderViewToggles() {
  document.querySelectorAll('.period-toggle').forEach((group) => {
    group.replaceChildren(...PERIODS.map((p) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(p === state.settings.view), 'data-period': p }, p)));
  });
}

function renderDashboard() {
  const items = state.items;
  const totals = totalsByPeriod(items);
  const view = state.settings.view;
  $('#headline-label').textContent = `${PERIOD_LABELS[view]} total`;
  $('#headline-value').textContent = formatMoney(totals[view]);
  $('#item-count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;

  $('#summary-cards').replaceChildren(...PERIODS.map((p) =>
    h('div', { class: 'card stat' }, h('span', { class: 'stat-label' }, PERIOD_LABELS[p]),
      h('span', { class: 'stat-value' }, formatMoney(totals[p])))));

  const total = totalYearly(items);
  const sorted = items.slice().sort((a, b) => yearlyCost(b) - yearlyCost(a));
  const top = sorted.slice(0, 5);
  const max = top.length ? yearlyCost(top[0]) : 1;
  const topList = $('#top-list');
  if (!items.length) {
    topList.replaceChildren(h('li', { class: 'empty' }, 'No items yet. Add some on the Items tab.'));
  } else {
    topList.replaceChildren(...top.map((it) => {
      const y = yearlyCost(it);
      return h('li', { class: 'top-row' },
        h('div', { class: 'top-head' }, h('span', { class: 'top-name' }, it.name),
          h('span', { class: 'top-amt' }, formatMoney(costForPeriod(it, view)),
            h('small', null, ` · ${(total ? (y / total) * 100 : 0).toFixed(1)}%`))),
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(y / max) * 100}%` })));
    }));
  }
  renderDonut(sorted, total, totals[view], view);
}

// Donut chart: top 6 items plus an "Other" slice, drawn with SVG circle strokes.
function renderDonut(sorted, total, viewTotal, view) {
  const holder = $('#donut');
  const legend = $('#legend');
  if (!sorted.length || !total) { holder.replaceChildren(); legend.replaceChildren(); return; }
  const slices = sorted.slice(0, 6).map((it) => ({ name: it.name, value: yearlyCost(it) }));
  const rest = sorted.slice(6).reduce((s, it) => s + yearlyCost(it), 0);
  if (rest > 0) slices.push({ name: 'Other', value: rest });
  const svg = svgEl('svg', { viewBox: '0 0 42 42', role: 'img', 'aria-label': 'Cost share by item' });
  svg.appendChild(svgEl('circle', { cx: 21, cy: 21, r: 15.9155, fill: 'none', stroke: 'var(--track)', 'stroke-width': 6 }));
  let offset = 25; // start at 12 o'clock
  slices.forEach((s, i) => {
    const pct = (s.value / total) * 100;
    const len = Math.max(pct - 0.4, 0); // small gap between slices
    svg.appendChild(svgEl('circle', {
      cx: 21, cy: 21, r: 15.9155, fill: 'none', stroke: CHART_COLORS[i % CHART_COLORS.length], 'stroke-width': 6,
      'stroke-dasharray': `${len} ${100 - len}`, 'stroke-dashoffset': offset,
    }));
    offset -= pct;
  });
  const t1 = svgEl('text', { x: 21, y: 21.2, 'text-anchor': 'middle', class: 'donut-num' });
  t1.textContent = formatMoney(viewTotal).replace(/\.\d\d$/, '');
  const t2 = svgEl('text', { x: 21, y: 25.6, 'text-anchor': 'middle', class: 'donut-sub' });
  t2.textContent = PERIOD_LABELS[view].toLowerCase();
  svg.append(t1, t2);
  holder.replaceChildren(svg);
  legend.replaceChildren(...slices.map((s, i) =>
    h('li', null, h('span', { class: 'swatch', style: `background:${CHART_COLORS[i % CHART_COLORS.length]}` }),
      h('span', { class: 'legend-name' }, s.name), h('span', { class: 'legend-pct' }, `${((s.value / total) * 100).toFixed(1)}%`))));
}

function visibleItems() {
  const q = state.search.trim().toLowerCase();
  const list = state.items.filter((it) => !q || it.name.toLowerCase().includes(q));
  const by = {
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    high: (a, b) => yearlyCost(b) - yearlyCost(a),
    low: (a, b) => yearlyCost(a) - yearlyCost(b),
  }[state.sort];
  // "newest" = most recently added first (items are appended to the array).
  return by ? list.sort(by) : list.reverse();
}

function renderItems() {
  const view = state.settings.view;
  const list = visibleItems();
  const ul = $('#item-list');
  const sum = list.reduce((s, it) => s + costForPeriod(it, view), 0);
  $('#items-summary').textContent = `${list.length} shown · ${PERIOD_LABELS[view].toLowerCase()} total ${formatMoney(sum)}`;
  if (!list.length) {
    ul.replaceChildren(h('li', { class: 'empty' }, state.items.length ? 'No items match your search.' : 'No items yet. Tap + to add one.'));
    return;
  }
  ul.replaceChildren(...list.map((it) =>
    h('li', { class: 'item-row' },
      h('button', { type: 'button', class: 'item-main', 'data-edit': it.id, 'aria-label': `Edit ${it.name}` },
        h('span', { class: 'item-text' }, h('span', { class: 'item-name' }, it.name), h('span', { class: 'item-freq' }, frequencyLabel(it))),
        h('span', { class: 'item-cost' }, formatMoney(costForPeriod(it, view)), h('small', null, ' /' + view.toLowerCase()))),
      h('button', { type: 'button', class: 'icon-btn danger', 'data-delete': it.id, 'aria-label': `Delete ${it.name}` }, '🗑'))));
}

function renderSettings() {
  document.querySelectorAll('#theme-toggle button').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.theme === state.settings.theme)));
}

function applyTheme() {
  const root = document.documentElement;
  if (state.settings.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = state.settings.theme;
  const dark = state.settings.theme === 'dark' || (state.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0b1626' : '#16315c');
}

/* ----- toast & dialogs ----- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
// Generic confirm dialog: resolves with the clicked button's value (or null if dismissed).
function ask(title, message, buttons) {
  return new Promise((resolve) => {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    $('#confirm-actions').replaceChildren(...buttons.map((b) =>
      h('button', { type: 'button', class: 'btn ' + (b.kind || ''), onclick: () => { dlg.dataset.result = b.value; dlg.close(); } }, b.label)));
    dlg.dataset.result = '';
    dlg.addEventListener('close', () => resolve(dlg.dataset.result || null), { once: true });
    dlg.showModal();
  });
}
const confirmDanger = async (title, message, label) =>
  (await ask(title, message, [{ label: 'Cancel', value: '', kind: 'ghost' }, { label, value: 'yes', kind: 'danger' }])) === 'yes';

/* ----- item form ----- */
function openForm(id) {
  state.editingId = id || null;
  const it = id ? state.items.find((x) => x.id === id) : null;
  $('#form-title').textContent = it ? 'Edit item' : 'Add item';
  $('#f-name').value = it ? it.name : '';
  $('#f-cost').value = it ? String(it.cost) : '';
  $('#f-every').value = it ? String(it.every) : '1';
  $('#f-period').value = it ? it.period : 'Month';
  ['name', 'cost', 'every'].forEach((k) => { $('#e-' + k).textContent = ''; $('#f-' + k).removeAttribute('aria-invalid'); });
  updatePreview();
  $('#form-dialog').showModal();
}
function validateForm() {
  const f = { name: $('#f-name').value.trim(), cost: parseCost($('#f-cost').value), everyText: $('#f-every').value.trim(), period: $('#f-period').value };
  const errors = {};
  if (!f.name) errors.name = 'Name is required.';
  if (!(f.cost > 0)) errors.cost = 'Enter a cost greater than 0.';
  if (!/^\d+$/.test(f.everyText) || Number(f.everyText) < 1) errors.every = 'Enter a whole number, 1 or more.';
  return { f, errors };
}
function updatePreview() {
  const { f, errors } = validateForm();
  const item = !errors.cost && !errors.every ? { cost: f.cost, every: Number(f.everyText), period: f.period } : null;
  $('#preview').replaceChildren(...PERIODS.map((p) =>
    h('div', { class: 'pv' }, h('span', null, PERIOD_LABELS[p]), h('strong', null, item ? formatMoney(costForPeriod(item, p)) : '—'))));
}
function submitForm(e) {
  e.preventDefault();
  const { f, errors } = validateForm();
  ['name', 'cost', 'every'].forEach((k) => {
    $('#e-' + k).textContent = errors[k] || '';
    if (errors[k]) $('#f-' + k).setAttribute('aria-invalid', 'true'); else $('#f-' + k).removeAttribute('aria-invalid');
  });
  const firstBad = ['name', 'cost', 'every'].find((k) => errors[k]);
  if (firstBad) { $('#f-' + firstBad).focus(); return; }
  const data = { name: f.name.slice(0, 80), cost: f.cost, every: Number(f.everyText), period: f.period };
  const editing = !!state.editingId;
  if (editing) Object.assign(state.items.find((x) => x.id === state.editingId), data);
  else state.items.push({ id: newId(), ...data });
  saveState(); $('#form-dialog').close(); render();
  toast(editing ? 'Item updated.' : 'Item added.');
}

/* ============================ EVENT HANDLERS =========================== */
async function handleImportFile(file) {
  let parsed;
  try { parsed = parseImport(await file.text(), file.name); } catch (e) { toast('Could not read that file.'); return; }
  if (!parsed.items.length) { toast('No valid items found in that file.'); return; }
  const n = parsed.items.length;
  const note = parsed.skipped ? ` (${parsed.skipped} invalid row${parsed.skipped === 1 ? '' : 's'} will be skipped)` : '';
  const choice = await ask('Import data',
    `Found ${n} item${n === 1 ? '' : 's'}${note}. Merge adds them to your current ${state.items.length} (matching ids are updated). Replace deletes your current items first.`,
    [{ label: 'Cancel', value: '', kind: 'ghost' }, { label: 'Merge', value: 'merge' }, { label: 'Replace', value: 'replace', kind: 'danger' }]);
  if (!choice) return;
  if (choice === 'replace') state.items = parsed.items;
  else parsed.items.forEach((it) => {
    const existing = state.items.find((x) => x.id === it.id);
    if (existing) Object.assign(existing, it); else state.items.push(it);
  });
  saveState(); render(); toast(`Imported ${n} items (${choice}).`);
}

function bindEvents() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
  }));
  document.addEventListener('click', async (e) => {
    const pt = e.target.closest('.period-toggle button');
    if (pt) { state.settings.view = pt.dataset.period; saveState(); render(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { openForm(ed.dataset.edit); return; }
    const del = e.target.closest('[data-delete]');
    if (del) {
      const it = state.items.find((x) => x.id === del.dataset.delete);
      if (it && await confirmDanger('Delete item?', `“${it.name}” will be removed.`, 'Delete')) {
        state.items = state.items.filter((x) => x.id !== it.id); saveState(); render(); toast('Item deleted.');
      }
    }
  });
  $('#fab').addEventListener('click', () => openForm(null));
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderItems(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderItems(); });

  const form = $('#item-form');
  form.addEventListener('submit', submitForm);
  form.addEventListener('input', updatePreview);
  $('#form-cancel').addEventListener('click', () => $('#form-dialog').close());

  $('#export-json').addEventListener('click', () =>
    download('budget-tracker.json', 'application/json', JSON.stringify({ schema: SCHEMA_VERSION, items: state.items }, null, 2)));
  $('#export-csv').addEventListener('click', () => download('budget-tracker.csv', 'text/csv', toCSV(state.items)));
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (file) await handleImportFile(file);
  });
  $('#load-example').addEventListener('click', async () => {
    if (await confirmDanger('Load example data?', 'This replaces all current items with the example set.', 'Replace')) {
      state.items = seedItems(); saveState(); render(); toast('Example data loaded.');
    }
  });
  $('#clear-all').addEventListener('click', async () => {
    if (await confirmDanger('Clear all data?', 'Every item will be permanently deleted from this device.', 'Clear all')) {
      state.items = []; saveState(); render(); toast('All data cleared.');
    }
  });
  document.querySelectorAll('#theme-toggle button').forEach((b) => b.addEventListener('click', () => {
    state.settings.theme = b.dataset.theme; saveState(); applyTheme(); renderSettings();
  }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  // Close dialogs when tapping the backdrop.
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => console.warn('SW registration failed', e));
  }
}

function init() {
  loadState(); applyTheme(); bindEvents(); render(); registerServiceWorker();
}

// Expose pure helpers for tests.html.
window.BudgetCalc = { PAYMENTS_PER_YEAR, seedItems, yearlyCost, costForPeriod, totalsByPeriod, toCSV, parseCSV, parseImport };
if (document.getElementById('app')) init();
