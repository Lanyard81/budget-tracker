/* Budget Tracker — entry point: state, rendering and event handlers.
   Pure logic lives in js/ (constants, dates, model, calc, storage, csv, bank, ics). */
import { PERIODS, PERIOD_LABELS, FEATURES, MAX_CATEGORIES } from './js/constants.js';
import { localToday, formatDate, formatShort, daysBetween } from './js/dates.js';
import { $, h, svgEl, formatMoney, formatPct, download } from './js/dom.js';
import * as C from './js/calc.js';
import { normaliseItem, normaliseSettings, normalisePriceChange, normaliseSpend, normaliseGoal, normaliseTxn, parseMoney, seedItems, mergeItems, newId } from './js/model.js';
import { createStorage, emptyData } from './js/storage.js';
import { itemsToCSV, parseImportFile, parseCSV } from './js/csv.js';
import { detectColumns, readTransactions, findRecurring } from './js/bank.js';
import { buildICS } from './js/ics.js';

/* ================================ STATE ================================ */
const store = createStorage(window.localStorage);
const state = {
  items: [], priceChanges: [], oneOffs: [], savingsGoals: [], savingsTxns: [], settings: normaliseSettings({}),
  editingSpendId: null,
  tab: 'dashboard', search: '', sort: 'name', fCat: '', fType: '', fStatus: '', fDue: false, editingId: null,
};
const T = () => localToday();
const save = () => { if (!store.set(state)) toast('Could not save (storage full or blocked).'); };

function loadState() {
  const { data, status } = store.get();
  Object.assign(state, { items: data.items, priceChanges: data.priceChanges, oneOffs: data.oneOffs, savingsGoals: data.savingsGoals, savingsTxns: data.savingsTxns, settings: data.settings });
  if (status === 'missing' || status === 'ok') save(); // persists first-run seed data and any schema migration
  if (status === 'corrupt') toast('Saved data was unreadable and has been reset (a raw copy was kept).');
  if (status === 'unavailable') toast('Storage is unavailable; changes will not be kept.');
}

/* ============================== RENDERING ============================== */
const dueText = (d) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);
const freqLabel = (it) => {
  const u = it.period.toLowerCase();
  const share = C.shareOf(it) < 1 ? ` · ${Math.round(C.shareOf(it) * 1000) / 10}% share` : '';
  return `${formatMoney(it.cost)} every ${it.every === 1 ? u : `${it.every} ${u}s`}${share}`;
};
const chip = (text, cls = '') => h('span', { class: 'chip ' + cls }, text);

// Optional features can be switched off in Settings; a disabled feature's tab and sections are hidden (data is kept).
const featureOn = (key) => state.settings.features[key];
const tabEnabled = (tab) => ({ spend: featureOn('oneOffs'), savings: featureOn('savings'), prices: featureOn('priceHistory') }[tab] ?? true);

function render() {
  const today = T();
  if (!tabEnabled(state.tab)) state.tab = 'dashboard';
  const alerts = featureOn('alerts') ? C.currentAlerts(state.items, today, state.settings.alertDays) : [];
  renderChrome(alerts);
  renderViewToggles();
  renderDashboard(today, alerts);
  renderFilters();
  renderItems(today);
  renderSpend(today);
  renderSavings(today);
  renderPrices(today);
  renderSettings();
}

function renderChrome(alerts) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + state.tab; });
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.hidden = !tabEnabled(b.dataset.tab);
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#fab').hidden = state.tab !== 'items';
  const badge = $('#tab-badge');
  badge.hidden = !alerts.length;
  badge.textContent = alerts.length;
  badge.setAttribute('aria-label', `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`);
  const banner = $('#alert-banner');
  banner.hidden = !alerts.length;
  if (alerts.length) {
    banner.replaceChildren(h('strong', null, `${alerts.length} alert${alerts.length === 1 ? '' : 's'}: `),
      alerts.slice(0, 3).map((a) => `${a.item.name} ${a.label === 'Trial ends soon' ? 'trial ends' : 'due'} ${dueText(a.days)}`).join(' · ') + (alerts.length > 3 ? ' …' : ''));
  }
}

function renderViewToggles() {
  document.querySelectorAll('.period-toggle[aria-label]:not(#theme-toggle)').forEach((group) => {
    group.replaceChildren(...PERIODS.map((p) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(p === state.settings.view), 'data-period': p }, p)));
  });
}

/* ----- dashboard ----- */
const section = (title, ...nodes) => h('section', { class: 'dash-section' }, h('h2', null, title), ...nodes);
const stat = (label, value, cls = '') => h('div', { class: 'card stat ' + cls }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value));

function renderDashboard(today, alerts) {
  const { items, settings } = state;
  const costs = C.totalCosts(items);
  const incY = C.incomeYearly(settings.income);
  const view = settings.view;
  $('#headline-label').textContent = `${PERIOD_LABELS[view]} costs`;
  $('#headline-value').textContent = formatMoney(costs[view]);
  const active = items.filter(C.isActive).length;
  $('#item-count').textContent = `${active} active ${active === 1 ? 'item' : 'items'}`;

  // Costs vs income
  const left = C.leftOver(costs.Year, incY);
  const hasInc = incY > 0;
  const rowsHtml = PERIODS.map((p) => h('tr', null, h('th', { scope: 'row' }, PERIOD_LABELS[p]),
    h('td', null, formatMoney(costs[p])), hasInc && h('td', null, formatMoney(C.fromYearly(incY, p))),
    hasInc && h('td', { class: left[p] < 0 ? 'neg' : 'pos' }, formatMoney(left[p]))));
  $('#dash-income').replaceChildren(h('h2', null, hasInc ? 'Costs vs income' : 'Costs'),
    h('div', { class: 'card tight' }, h('table', { class: 'cmp' },
      h('thead', null, h('tr', null, h('th', null, 'Per'), h('th', null, 'Costs'), hasInc && h('th', null, 'Income'), hasInc && h('th', null, 'Left over'))),
      h('tbody', null, rowsHtml),
      hasInc && h('tfoot', null, h('tr', null, h('th', { scope: 'row', colspan: 3 }, '% of income spent'), h('td', null, formatPct(C.pctOfIncomeSpent(costs.Year, incY)))))),
    !hasInc && h('p', { class: 'muted pad' }, 'Add your income in Settings to see what is left over.')));

  const body = [];
  // Key numbers
  const rises = C.priceRises(state.priceChanges, items, today, settings.lookbackDays);
  body.push(section('Key numbers', h('div', { class: 'cards' },
    stat('Active items', active), stat('Paused items', items.length - active),
    stat('Paused saves / year', formatMoney(C.pausedSavesPerYear(items)), 'good'),
    featureOn('priceHistory') && stat(`Price rises (${settings.lookbackDays} days)`, rises.count),
    featureOn('priceHistory') && stat('Rise impact / year', formatMoney(rises.yearlyImpact), rises.yearlyImpact > 0 ? 'bad' : ''),
    featureOn('alerts') && stat('Alerts right now', alerts.length, alerts.length ? 'warn' : ''))));

  const anyDates = items.some((it) => it.paymentDate);
  if (!anyDates && items.length) {
    body.push(h('div', { class: 'card hint-card' }, h('strong', null, 'Tip: add payment dates. '),
      'Give items a payment date (any date they were or will be paid) to unlock due dates, alerts, cash-needed totals and exact 12-month forecasts.'));
  }

  // Cash needed
  body.push(section('Cash needed soon', h('div', { class: 'cards three' }, [7, 14, 30].map((d) => {
    const c = C.cashNeeded(items, today, d);
    return h('div', { class: 'card stat' }, h('span', { class: 'stat-label' }, `Next ${d} days`),
      h('span', { class: 'stat-value' }, formatMoney(c.total)), h('span', { class: 'stat-sub' }, `${c.payments} payment${c.payments === 1 ? '' : 's'}`));
  }))));

  // Upcoming
  const up = C.upcomingPayments(items, today, 10);
  body.push(section('Upcoming payments', up.length
    ? h('ul', { class: 'upcoming card' }, up.map((u) => {
      const al = featureOn('alerts') ? C.alertFor(u.item, today, settings.alertDays) : null;
      return h('li', { class: al ? 'alerting' : '' },
        h('div', { class: 'up-main' }, h('span', { class: 'up-name' }, u.item.name),
          h('span', { class: 'up-sub' }, `${formatDate(u.due, today)} · ${dueText(u.days)}`, u.item.category ? ` · ${u.item.category}` : '')),
        h('div', { class: 'up-side' }, h('span', { class: 'up-amt' }, formatMoney(u.amount)), al && chip('▲ ' + al, 'warn')));
    }))
    : h('p', { class: 'muted card' }, 'No dated items yet.')));

  // One-off spends and savings (optional features)
  if (featureOn('oneOffs')) {
    const os = C.oneOffSummary(state.oneOffs, today, settings.categories);
    body.push(section('One-off spends', h('div', { class: 'cards three' },
      stat('This month', formatMoney(os.thisMonth)), stat('Last 30 days', formatMoney(os.last30)), stat('Year to date', formatMoney(os.ytd))),
    os.byCategory.length ? h('ul', { class: 'upcoming card' }, os.byCategory.slice(0, 4).map((c) => h('li', null,
      h('div', { class: 'up-main' }, h('span', { class: 'up-name' }, c.name), h('span', { class: 'up-sub' }, `${formatPct(c.pct)} of this month`)),
      h('div', { class: 'up-side' }, h('span', { class: 'up-amt' }, formatMoney(c.total)))))) : h('p', { class: 'muted' }, 'Nothing logged this month. Add spends on the Spend tab.')));
  }
  if (featureOn('savings')) {
    const goals = state.savingsGoals;
    body.push(section('Savings', h('div', { class: 'cards' }, stat('Total saved', formatMoney(C.totalSaved(goals, state.savingsTxns)), 'good'), stat('Goals', goals.length)),
      goals.length ? h('ul', { class: 'top-list card' }, goals.slice(0, 5).map((g) => {
        const st = C.goalStatus(g, state.savingsTxns, today);
        return h('li', { class: 'top-row' }, h('div', { class: 'top-head' }, h('span', { class: 'top-name' }, g.name),
          h('span', { class: 'top-amt' }, formatMoney(st.saved), st.target > 0 && h('small', null, ` of ${formatMoney(st.target)}`))),
        st.pct !== null && h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${st.pct * 100}%` })));
      })) : h('p', { class: 'muted' }, 'No savings goals yet. Add one on the Savings tab.')));
  }

  // Categories
  const cat = C.breakdownByCategory(items, settings.categories, incY);
  const catRows = cat.rows.filter((r) => r.yearly > 0);
  body.push(section('Costs by category', catRows.length ? [barChart(catRows, 'Costs by category (yearly)'), breakdownTable(catRows, cat.total, 'Category', hasInc)] : h('p', { class: 'muted card' }, 'No active items.')));

  // Needs vs wants
  const typ = C.breakdownByType(items, incY);
  body.push(section('Needs vs wants', breakdownTable(typ.rows, typ.total, 'Type', hasInc)));

  // Sinking fund
  const sf = C.sinkingFund(items, today, settings.lumpDays);
  if (featureOn('sinkingFund')) body.push(section('Sinking fund', h('div', { class: 'cards' },
    stat('Set aside / fortnight', formatMoney(sf.setAsidePerFortnight)), stat('Should have saved by now', formatMoney(sf.shouldHaveSavedTotal))),
  sf.next.length ? h('ul', { class: 'upcoming card' }, sf.next.map((r) => h('li', null,
    h('div', { class: 'up-main' }, h('span', { class: 'up-name' }, r.item.name), h('span', { class: 'up-sub' }, `${formatDate(r.due, today)} · ${dueText(r.days)}`)),
    h('div', { class: 'up-side' }, h('span', { class: 'up-amt' }, formatMoney(r.bill)), h('span', { class: 'up-sub' }, `saved ${formatMoney(r.shouldHave)}`)))))
    : h('p', { class: 'muted' }, sf.count ? 'Add payment dates to lump-sum bills to see when they are due.' : `No bills with ${settings.lumpDays}+ days between payments.`)));

  // 12-month forecast
  if (featureOn('forecast')) {
    const fc = C.forecast12(items, today);
    body.push(section('Next 12 months of cash-out', columnChart(fc.windows), forecastTable(fc, today)));
  }

  // Top 5
  const top = C.topItems(items, 5);
  body.push(section('Top 5 most expensive', h('ol', { class: 'top-list card' }, top.length ? top.map((t) =>
    h('li', { class: 'top-row' }, h('div', { class: 'top-head' }, h('span', { class: 'top-name' }, t.item.name),
      h('span', { class: 'top-amt' }, formatMoney(C.periodAmount(t.item, view)), h('small', null, ` · ${formatPct(t.pct)}`))),
    h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(t.yearly / top[0].yearly) * 100}%` })))) : h('li', { class: 'empty' }, 'No active items.'))));

  $('#dash-body').replaceChildren(...body);
}

// Rows become stacked cards on a phone: a table underneath, so screen readers still get headers.
function breakdownTable(rows, total, firstHead, hasInc) {
  const cells = (r, isTotal) => [
    h(isTotal ? 'td' : 'th', { scope: isTotal ? null : 'row', class: 'rt-name' }, r.name),
    ...['Week', 'Fortnight', 'Month', 'Year'].map((p) => h('td', { 'data-label': PERIOD_LABELS[p] }, formatMoney(r[p]))),
    h('td', { 'data-label': '% of costs' }, formatPct(r.pctCosts)),
    hasInc && h('td', { 'data-label': '% of income' }, formatPct(r.pctIncome)),
  ];
  return h('div', { class: 'card tight' }, h('table', { class: 'rtable' },
    h('thead', null, h('tr', null, [firstHead, 'Weekly', 'Fortnightly', 'Monthly', 'Yearly', '% of costs', hasInc && '% of income'].map((t) => t && h('th', null, t)))),
    h('tbody', null, rows.map((r) => h('tr', null, cells(r, false)))),
    h('tfoot', null, h('tr', { class: 'total' }, cells(total, true)))));
}

function barChart(rows, title) {
  const max = Math.max(...rows.map((r) => r.yearly), 1);
  const rowH = 34; const W = 360; const H = rows.length * rowH + 4;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': 'bc-t bc-d', class: 'chart' });
  svg.append(svgEl('title', { id: 'bc-t' }, title),
    svgEl('desc', { id: 'bc-d' }, rows.map((r) => `${r.name}: ${formatMoney(r.yearly)} a year`).join('; ') + '. The same figures are in the table below.'));
  rows.forEach((r, i) => {
    const y = i * rowH;
    svg.append(svgEl('text', { x: 0, y: y + 13, class: 'ct' }, r.name), svgEl('text', { x: W, y: y + 13, class: 'ct', 'text-anchor': 'end' }, formatMoney(r.yearly)),
      svgEl('rect', { x: 0, y: y + 18, width: W, height: 9, rx: 4.5, class: 'ctrack' }),
      svgEl('rect', { x: 0, y: y + 18, width: Math.max((r.yearly / max) * W, 3), height: 9, rx: 4.5, class: 'cbar' }));
  });
  return h('div', { class: 'card' }, svg);
}

function columnChart(windows) {
  const W = 360; const H = 215; const top = 16; const bottom = 50; const gap = 4;
  const max = Math.max(...windows.map((w) => w.total), 1);
  const bw = (W - gap * 13) / 12; const plot = H - top - bottom;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': 'fc-t fc-d', class: 'chart' });
  svg.append(svgEl('title', { id: 'fc-t' }, 'Forecast cash-out for the next 12 months'),
    svgEl('desc', { id: 'fc-d' }, windows.map((w) => `From ${formatShort(w.start)}: ${formatMoney(w.total)}`).join('; ') + '. The same figures are in the table below.'));
  windows.forEach((w, i) => {
    const bh = Math.max((w.total / max) * plot, 1); const x = gap + i * (bw + gap); const y = top + plot - bh;
    svg.append(svgEl('rect', { x, y, width: bw, height: bh, rx: 3, class: 'cbar' }),
      svgEl('text', { x: x + bw / 2, y: y - 3, class: 'cv', 'text-anchor': 'middle' }, String(Math.round(w.total))),
      svgEl('text', { x: x + bw / 2 + 3, y: top + plot + 10, class: 'cl', 'text-anchor': 'end', transform: `rotate(-50 ${x + bw / 2 + 3} ${top + plot + 10})` }, formatShort(w.start)));
  });
  return h('div', { class: 'card' }, svg);
}

function forecastTable(fc, today) {
  return h('div', { class: 'card tight' }, h('table', { class: 'cmp' },
    h('caption', { class: 'sr-only' }, '12-month cash-out forecast'),
    h('thead', null, h('tr', null, h('th', null, 'Window starts'), h('th', null, 'Cash out'))),
    h('tbody', null, fc.windows.map((w) => h('tr', null, h('th', { scope: 'row' }, formatDate(w.start, today)), h('td', null, formatMoney(w.total))))),
    h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, '12-month total'), h('td', null, formatMoney(fc.total))))));
}

/* ----- items ----- */
function renderFilters() {
  const sel = $('#flt-cat');
  const cur = state.fCat;
  sel.replaceChildren(h('option', { value: '' }, 'All categories'), ...state.settings.categories.map((c) => h('option', { value: c, selected: c === cur }, c)),
    h('option', { value: '__none', selected: cur === '__none' }, 'Uncategorised'));
  sel.value = cur;
  $('#flt-type').value = state.fType; $('#flt-status').value = state.fStatus; $('#flt-due').checked = state.fDue; $('#sort').value = state.sort;
}

function visibleItems(today) {
  const q = state.search.trim().toLowerCase();
  const cats = state.settings.categories;
  const list = state.items.filter((it) => {
    if (q && !it.name.toLowerCase().includes(q) && !it.notes.toLowerCase().includes(q)) return false;
    if (state.fCat === '__none' ? cats.includes(it.category) : state.fCat && it.category !== state.fCat) return false;
    if (state.fType === 'none' ? it.type : state.fType && it.type !== state.fType) return false;
    if (state.fStatus && (state.fStatus === 'active') !== C.isActive(it)) return false;
    if (state.fDue) { const d = C.daysUntil(it, today); if (!C.isActive(it) || d === null || d > state.settings.alertDays) return false; }
    return true;
  });
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    high: (a, b) => C.yearlyOf(b) - C.yearlyOf(a), low: (a, b) => C.yearlyOf(a) - C.yearlyOf(b),
    due: (a, b) => { const x = C.nextDue(a, today); const y = C.nextDue(b, today); return x && y ? (x < y ? -1 : x > y ? 1 : 0) : x ? -1 : y ? 1 : 0; },
  }[state.sort];
  return cmp ? list.sort(cmp) : list.reverse(); // newest = last added first
}

function renderItems(today) {
  const view = state.settings.view;
  const list = visibleItems(today);
  const riseIds = featureOn('priceHistory') ? C.priceRises(state.priceChanges, state.items, today, state.settings.lookbackDays).itemIds : new Set();
  const sum = list.filter(C.isActive).reduce((s, it) => s + C.periodAmount(it, view), 0);
  $('#items-summary').textContent = `${list.length} shown · active ${PERIOD_LABELS[view].toLowerCase()} total ${formatMoney(sum)}`;
  const ul = $('#item-list');
  if (!list.length) { ul.replaceChildren(h('li', { class: 'empty' }, state.items.length ? 'No items match.' : 'No items yet. Tap + to add one.')); return; }
  ul.replaceChildren(...list.map((it) => {
    const active = C.isActive(it);
    const due = active ? C.nextDue(it, today) : null;
    const alert = featureOn('alerts') ? C.alertFor(it, today, state.settings.alertDays) : null;
    return h('li', { class: 'item-row' + (active ? '' : ' paused') },
      h('button', { type: 'button', class: 'item-main', 'data-edit': it.id, 'aria-label': `Edit ${it.name}` },
        h('span', { class: 'item-text' }, h('span', { class: 'item-name' }, it.name), h('span', { class: 'item-freq' }, freqLabel(it))),
        h('span', { class: 'item-cost' }, formatMoney(C.periodAmount(it, view)), h('small', null, ' /' + view.toLowerCase()))),
      h('div', { class: 'chips' }, !active && chip('‖ Paused'), it.category && chip(it.category), it.type && chip(it.type, it.type === 'Need' ? 'need' : 'want'),
        due && chip(`Due ${formatDate(due, today)} · ${dueText(daysBetween(today, due))}`), alert && chip('▲ ' + alert, 'warn'), riseIds.has(it.id) && chip('▲ Price rise', 'bad')),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn small', 'data-toggle': it.id }, active ? 'Pause' : 'Resume'),
        h('button', { type: 'button', class: 'btn small', 'data-whatif': it.id }, 'What if I cancel?'),
        h('button', { type: 'button', class: 'btn small danger', 'data-delete': it.id, 'aria-label': `Delete ${it.name}` }, 'Delete')));
  }));
}

/* ----- one-off spends ----- */
function renderSpend(today) {
  const cats = state.settings.categories;
  const sel = $('#sp-cat'); const cur = sel.value;
  sel.replaceChildren(h('option', { value: '' }, '— none —'), ...cats.map((c) => h('option', { value: c }, c)));
  sel.value = cats.includes(cur) ? cur : '';
  if (!$('#sp-date').value) $('#sp-date').value = today;
  const sum = C.oneOffSummary(state.oneOffs, today, cats);
  $('#spend-summary').replaceChildren(stat('This month', formatMoney(sum.thisMonth)), stat('Last 30 days', formatMoney(sum.last30)),
    stat('Year to date', formatMoney(sum.ytd)), stat('+ monthly recurring', formatMoney(sum.thisMonth + C.totalCosts(state.items).Month)));
  const list = state.oneOffs.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  $('#spend-list').replaceChildren(...(list.length ? list.map((sp) => h('li', { class: 'item-row' },
    h('button', { type: 'button', class: 'item-main', 'data-spend-edit': sp.id, 'aria-label': `Edit ${sp.name}` },
      h('span', { class: 'item-text' }, h('span', { class: 'item-name' }, sp.name), h('span', { class: 'item-freq' }, formatDate(sp.date, today) + (sp.category ? ` · ${sp.category}` : ''))),
      h('span', { class: 'item-cost' }, formatMoney(sp.amount))),
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small danger', 'data-spend-del': sp.id, 'aria-label': `Delete ${sp.name}` }, 'Delete'))))
    : [h('li', { class: 'empty' }, 'No one-off spends yet.')]));
}
function endSpendEdit() {
  state.editingSpendId = null;
  $('#sp-name').value = ''; $('#sp-amount').value = '';
  $('#spend-form-title').textContent = 'Add a one-off spend'; $('#sp-submit').textContent = 'Add spend'; $('#sp-cancel').hidden = true;
}
function startSpendEdit(sp) {
  state.editingSpendId = sp.id;
  $('#sp-name').value = sp.name; $('#sp-amount').value = String(sp.amount); $('#sp-date').value = sp.date; $('#sp-cat').value = sp.category;
  $('#spend-form-title').textContent = 'Edit spend'; $('#sp-submit').textContent = 'Update spend'; $('#sp-cancel').hidden = false; $('#sp-error').textContent = '';
  window.scrollTo(0, 0); $('#sp-name').focus();
}
function submitSpend(e) {
  e.preventDefault();
  const name = $('#sp-name').value.trim(); const amount = parseMoney($('#sp-amount').value); const date = $('#sp-date').value;
  const msg = !name ? 'Enter what you spent it on.' : !(amount > 0) ? 'Amount must be greater than 0.' : !date ? 'Enter a date.' : '';
  $('#sp-error').textContent = msg;
  if (msg) return;
  const editing = state.oneOffs.find((x) => x.id === state.editingSpendId);
  const sp = normaliseSpend({ id: editing ? editing.id : newId(), name, amount, date, category: $('#sp-cat').value });
  if (editing) Object.assign(editing, sp); else state.oneOffs.push(sp);
  toast(editing ? 'Spend updated.' : 'Spend added.');
  endSpendEdit(); save(); render();
}

/* ----- savings ----- */
function renderSavings(today) {
  const goals = state.savingsGoals; const txns = state.savingsTxns;
  $('#savings-total').replaceChildren(h('div', { class: 'cards' }, stat('Total saved', formatMoney(C.totalSaved(goals, txns)), 'good'), stat('Goals', goals.length)));
  $('#goal-list').replaceChildren(...(goals.length ? goals.map((g) => goalCard(g, today)) : [h('li', { class: 'empty' }, 'No savings goals yet. Add one above.')]));
}
function goalCard(g, today) {
  const st = C.goalStatus(g, state.savingsTxns, today);
  const history = state.savingsTxns.filter((t) => t.goalId === g.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const sub = st.target > 0 ? `Target ${formatMoney(st.target)}${g.targetDate ? ` by ${formatDate(g.targetDate, today)}` : ''}` : 'No target set';
  const plan = st.reached ? chip('✓ Goal reached', 'good')
    : st.perFortnight !== null ? chip(`Save ${formatMoney(st.perFortnight)} / fortnight`, 'need')
      : st.daysLeft !== null && st.daysLeft <= 0 && st.target > 0 ? chip('▲ Past target date', 'warn') : null;
  return h('li', { class: 'item-row' },
    h('div', { class: 'item-main static' },
      h('span', { class: 'item-text' }, h('span', { class: 'item-name' }, g.name), h('span', { class: 'item-freq' }, sub)),
      h('span', { class: 'item-cost' }, formatMoney(st.saved))),
    st.pct !== null && h('div', { class: 'goal-progress' },
      h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${g.name} progress`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(st.pct * 100)) },
        h('span', { class: st.reached ? 'done' : '', style: `width:${st.pct * 100}%` })),
      h('p', { class: 'goal-meta' }, `${Math.round(st.pct * 100)}% · ${st.reached ? 'target met' : `${formatMoney(st.remaining)} to go`}`)),
    plan && h('div', { class: 'chips' }, plan),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn small', 'data-goal-in': g.id }, 'Add money'),
      h('button', { type: 'button', class: 'btn small', 'data-goal-out': g.id }, 'Withdraw'),
      h('button', { type: 'button', class: 'btn small', 'data-goal-edit': g.id }, 'Edit')),
    history.length > 0 && h('details', { class: 'history' }, h('summary', null, `History (${history.length})`),
      h('ul', null, history.slice(0, 20).map((t) => h('li', null,
        h('span', null, `${formatDate(t.date, today)} · `, h('strong', { class: t.amount > 0 ? 'pos' : 'neg' }, `${t.amount > 0 ? '+' : '−'}${formatMoney(Math.abs(t.amount))}`)),
        h('button', { type: 'button', class: 'btn small danger', 'data-txn-del': t.id, 'aria-label': 'Delete this entry' }, 'Delete'))))));
}
function submitGoal(e) {
  e.preventDefault();
  const name = $('#g-name').value.trim(); const targetText = $('#g-target').value.trim(); const startText = $('#g-start').value.trim();
  const target = targetText ? parseMoney(targetText) : 0; const start = startText ? parseMoney(startText) : 0;
  const msg = !name ? 'Enter a goal name.' : !(target >= 0) ? 'Target must be a number.' : !(start >= 0) ? 'Already saved must be a number.' : '';
  $('#g-error').textContent = msg;
  if (msg) return;
  const goal = normaliseGoal({ id: newId(), name, target, targetDate: $('#g-date').value });
  state.savingsGoals.push(goal);
  if (start > 0) state.savingsTxns.push(normaliseTxn({ id: newId(), goalId: goal.id, date: T(), amount: start }));
  ['#g-name', '#g-target', '#g-start', '#g-date'].forEach((id) => { $(id).value = ''; });
  save(); render(); toast(`Goal “${goal.name}” added.`);
}
function openGoalMoney(goal, mode) {
  const bal = C.goalBalance(goal, state.savingsTxns);
  const amt = h('input', { id: 'gm-amt', type: 'text', inputmode: 'decimal', autocomplete: 'off' });
  const date = h('input', { id: 'gm-date', type: 'date', value: T() });
  const err = h('p', { class: 'error', role: 'alert' });
  const body = h('form', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    const a = parseMoney(amt.value);
    err.textContent = !(a > 0) ? 'Enter an amount greater than 0.' : !date.value ? 'Enter a date.' : mode === 'out' && a > bal + 1e-9 ? `Only ${formatMoney(bal)} is saved in this goal.` : '';
    if (err.textContent) return;
    state.savingsTxns.push(normaliseTxn({ id: newId(), goalId: goal.id, date: date.value, amount: mode === 'out' ? -a : a }));
    save(); render(); closeSheet(); toast(mode === 'out' ? `Withdrew ${formatMoney(a)}.` : `Added ${formatMoney(a)} to ${goal.name}.`);
  } },
  h('div', { class: 'field' }, h('label', { for: 'gm-amt' }, 'Amount ($)'), amt), h('div', { class: 'field' }, h('label', { for: 'gm-date' }, 'Date'), date), err,
  h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: closeSheet }, 'Cancel'), h('button', { type: 'submit', class: 'btn primary' }, mode === 'out' ? 'Withdraw' : 'Add money')));
  openSheet(`${mode === 'out' ? 'Withdraw from' : 'Add money to'} ${goal.name}`, body);
  amt.focus();
}
function openGoalEdit(goal) {
  const name = h('input', { id: 'ge-name', type: 'text', value: goal.name, maxlength: 80 });
  const target = h('input', { id: 'ge-target', type: 'text', inputmode: 'decimal', value: goal.target > 0 ? String(goal.target) : '' });
  const date = h('input', { id: 'ge-date', type: 'date', value: goal.targetDate });
  const err = h('p', { class: 'error', role: 'alert' });
  const body = h('form', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    const t = target.value.trim() ? parseMoney(target.value) : 0;
    err.textContent = !name.value.trim() ? 'Enter a goal name.' : !(t >= 0) ? 'Target must be a number.' : '';
    if (err.textContent) return;
    Object.assign(goal, normaliseGoal({ id: goal.id, name: name.value, target: t, targetDate: date.value }));
    save(); render(); closeSheet(); toast('Goal updated.');
  } },
  h('div', { class: 'field' }, h('label', { for: 'ge-name' }, 'Goal name'), name), h('div', { class: 'field' }, h('label', { for: 'ge-target' }, 'Target ($, blank for none)'), target),
  h('div', { class: 'field' }, h('label', { for: 'ge-date' }, 'Target date'), date), err,
  h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn danger', onclick: async () => {
      if (await confirmDanger('Delete goal?', `“${goal.name}” and its history will be deleted.`, 'Delete')) {
        state.savingsGoals = state.savingsGoals.filter((g) => g.id !== goal.id); state.savingsTxns = state.savingsTxns.filter((t) => t.goalId !== goal.id);
        save(); render(); closeSheet(); toast('Goal deleted.');
      }
    } }, 'Delete goal'),
    h('button', { type: 'button', class: 'btn ghost', onclick: closeSheet }, 'Cancel'), h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
  openSheet('Edit goal', body);
}

/* ----- price history ----- */
function renderPrices(today) {
  const sel = $('#p-item');
  const cur = sel.value;
  sel.replaceChildren(h('option', { value: '' }, 'Choose an item…'),
    ...state.items.slice().sort((a, b) => a.name.localeCompare(b.name)).map((it) => h('option', { value: it.id, selected: it.id === cur }, it.name)));
  sel.value = cur;
  if (!$('#p-date').value) $('#p-date').value = today;
  const ul = $('#price-list');
  const infos = state.priceChanges.map((c) => C.priceChangeInfo(c, state.items)).sort((a, b) => (a.change.date < b.change.date ? 1 : -1));
  if (!infos.length) { ul.replaceChildren(h('li', { class: 'empty' }, 'No price changes logged yet.')); return; }
  ul.replaceChildren(...infos.map((r) => {
    const rise = r.diff > 0; const cls = rise ? 'bad' : 'good'; const sign = rise ? '+' : '';
    return h('li', { class: 'item-row price-row' },
      h('div', { class: 'item-main static' },
        h('span', { class: 'item-text' }, h('span', { class: 'item-name' }, r.item ? r.item.name : '(deleted item)'),
          h('span', { class: 'item-freq' }, `${formatDate(r.change.date, today)} · ${formatMoney(r.change.oldCost)} → ${formatMoney(r.change.newCost)}`)),
        h('span', { class: 'item-cost ' + cls }, `${sign}${formatMoney(r.diff)}`, h('small', null, ` ${sign}${(r.pct * 100).toFixed(1)}%`))),
      h('div', { class: 'chips' }, r.item && chip(`${rise ? '▲' : '▼'} ${sign}${formatMoney(r.yearlyImpact)} / year`, cls)),
      h('div', { class: 'row-actions' },
        r.item && Math.abs(r.item.cost - r.change.newCost) > 1e-9 && h('button', { type: 'button', class: 'btn small', 'data-price-apply': r.change.id }, `Set item cost to ${formatMoney(r.change.newCost)}`),
        h('button', { type: 'button', class: 'btn small danger', 'data-price-delete': r.change.id }, 'Delete')));
  }));
}

/* ----- settings ----- */
function renderSettings() {
  const s = state.settings;
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  set('#s-inc-amount', s.income.amount > 0 ? String(s.income.amount) : ''); set('#s-inc-every', String(s.income.every));
  set('#s-inc-period', s.income.period); set('#s-alert', String(s.alertDays)); set('#s-lump', String(s.lumpDays)); set('#s-look', String(s.lookbackDays));
  document.querySelectorAll('#theme-toggle button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === s.theme)));
  if (!$('#feature-list').contains(document.activeElement)) {
    $('#feature-list').replaceChildren(...FEATURES.map((f) => h('label', { class: 'check feature' },
      h('input', { type: 'checkbox', 'data-feature': f.key, checked: s.features[f.key] }), h('span', null, h('strong', null, f.label), h('br'), h('span', { class: 'hint' }, f.hint)))));
  }
  if (!$('#cat-list').contains(document.activeElement)) {
    $('#cat-list').replaceChildren(...s.categories.map((c, i) => h('div', { class: 'cat-row' },
      h('label', { for: 'cat-' + i, class: 'sr-only' }, `Category ${i + 1}`), h('input', { id: 'cat-' + i, type: 'text', value: c, maxlength: 40, 'data-cat': i }),
      h('button', { type: 'button', class: 'btn small danger', 'data-cat-del': i, 'aria-label': `Remove ${c}` }, 'Remove'))));
  }
  renderNotifyUI();
}
function renderNotifyUI() {
  const btn = $('#notify-btn'); const note = $('#notify-note');
  if (!('Notification' in window)) { btn.disabled = true; note.textContent = 'Notifications are not supported in this browser. On iPhone they only work for the installed home-screen app (iOS 16.4+).'; return; }
  const on = state.settings.notify && Notification.permission === 'granted';
  btn.textContent = on ? 'Notifications on — tap to turn off' : 'Notify me when I open the app';
  note.textContent = Notification.permission === 'denied' ? 'Notifications are blocked in your browser settings.' : 'Shows a notification for current alerts each time you open the app. It cannot notify you while the app is closed.';
}

function applyTheme() {
  const root = document.documentElement;
  const t = state.settings.theme;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#07070b' : '#f2f2f7');
}

/* ----- toast & dialogs ----- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
// Confirm dialog: resolves to the clicked button's value, or null if dismissed. `content` may be a string or Node.
function ask(title, content, buttons) {
  return new Promise((resolve) => {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-message').replaceChildren(typeof content === 'string' ? h('p', null, content) : content);
    $('#confirm-actions').replaceChildren(...buttons.map((b) =>
      h('button', { type: 'button', class: 'btn ' + (b.kind || ''), onclick: () => { dlg.dataset.result = b.value; dlg.close(); } }, b.label)));
    dlg.dataset.result = '';
    dlg.addEventListener('close', () => resolve(dlg.dataset.result || null), { once: true });
    dlg.showModal();
  });
}
const confirmDanger = async (title, msg, label) =>
  (await ask(title, msg, [{ label: 'Cancel', value: '', kind: 'ghost' }, { label, value: 'yes', kind: 'danger' }])) === 'yes';

function openSheet(title, body) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').replaceChildren(body);
  const dlg = $('#sheet-dialog');
  if (!dlg.open) dlg.showModal();
}
const closeSheet = () => $('#sheet-dialog').close();

/* ----- item form ----- */
function openForm(id) {
  state.editingId = id || null;
  const it = id ? state.items.find((x) => x.id === id) : null;
  $('#form-title').textContent = it ? 'Edit item' : 'Add item';
  $('#f-name').value = it ? it.name : '';
  $('#f-cost').value = it ? String(it.cost) : '';
  $('#f-every').value = it ? String(it.every) : '1';
  $('#f-period').value = it ? it.period : 'Month';
  const cats = state.settings.categories;
  const extra = it && it.category && !cats.includes(it.category) ? [it.category] : [];
  $('#f-category').replaceChildren(h('option', { value: '' }, '— none —'), ...[...cats, ...extra].map((c) => h('option', { value: c }, c)));
  $('#f-category').value = it ? it.category : '';
  $('#f-type').value = it ? it.type : '';
  $('#f-share').value = it ? String(Math.round(C.shareOf(it) * 10000) / 100) : '100';
  $('#f-paydate').value = it ? it.paymentDate : '';
  $('#f-trial').value = it ? it.trialEnds : '';
  $('#f-active').checked = it ? C.isActive(it) : true;
  $('#f-notes').value = it ? it.notes : '';
  $('#f-link').value = it ? it.link : '';
  ['name', 'cost', 'every', 'share'].forEach((k) => { $('#e-' + k).textContent = ''; $('#f-' + k).removeAttribute('aria-invalid'); });
  updatePreview();
  $('#form-dialog').showModal();
}
function validateForm() {
  const f = {
    name: $('#f-name').value.trim(), cost: parseMoney($('#f-cost').value), everyText: $('#f-every').value.trim(), period: $('#f-period').value,
    category: $('#f-category').value, type: $('#f-type').value, shareText: $('#f-share').value.trim(), paymentDate: $('#f-paydate').value,
    trialEnds: $('#f-trial').value, active: $('#f-active').checked, notes: $('#f-notes').value.trim(), link: $('#f-link').value.trim(),
  };
  const errors = {};
  if (!f.name) errors.name = 'Name is required.';
  if (!(f.cost > 0)) errors.cost = 'Enter a cost greater than 0.';
  if (!/^\d+$/.test(f.everyText) || Number(f.everyText) < 1) errors.every = 'Enter a whole number, 1 or more.';
  const pct = f.shareText === '' ? 100 : Number(f.shareText.replace(/%$/, ''));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors.share = 'Enter a share from 0 to 100.';
  f.share = pct / 100;
  return { f, errors };
}
function updatePreview() {
  const { f, errors } = validateForm();
  const ok = !errors.cost && !errors.every && !errors.share;
  const item = ok ? { cost: f.cost, every: Number(f.everyText), period: f.period, share: f.share, paymentDate: f.paymentDate } : null;
  $('#preview').replaceChildren(...PERIODS.map((p) => h('div', { class: 'pv' }, h('span', null, PERIOD_LABELS[p]), h('strong', null, item ? formatMoney(C.periodAmount(item, p)) : '—'))));
  const today = T();
  const due = item ? C.nextDue(item, today) : null;
  $('#preview-due').textContent = due ? `Next due: ${formatDate(due, today)} (${dueText(daysBetween(today, due))})` : 'Next due: add a payment date to see it.';
}
function submitForm(e) {
  e.preventDefault();
  const { f, errors } = validateForm();
  ['name', 'cost', 'every', 'share'].forEach((k) => {
    $('#e-' + k).textContent = errors[k] || '';
    if (errors[k]) $('#f-' + k).setAttribute('aria-invalid', 'true'); else $('#f-' + k).removeAttribute('aria-invalid');
  });
  const bad = ['name', 'cost', 'every', 'share'].find((k) => errors[k]);
  if (bad) { $('#f-' + bad).focus(); return; }
  const res = normaliseItem({ id: state.editingId, ...f, every: Number(f.everyText), type: f.type });
  if (res.error) { toast(res.error); return; }
  const editing = !!state.editingId;
  if (editing) Object.assign(state.items.find((x) => x.id === state.editingId), res.item); else state.items.push(res.item);
  save(); $('#form-dialog').close(); render(); toast(editing ? 'Item updated.' : 'Item added.');
}

/* ----- what if I cancel ----- */
function openWhatIf(item) {
  const yearly = C.yearlyOf(item);
  const body = h('div', null,
    h('p', null, `If you cancel ${item.name} you would save:`),
    h('div', { class: 'preview' }, PERIODS.map((p) => h('div', { class: 'pv' }, h('span', null, PERIOD_LABELS[p]), h('strong', { class: 'good-text' }, formatMoney(C.fromYearly(yearly, p)))))),
    !C.isActive(item) && h('p', { class: 'muted' }, 'This item is already paused, so it is not counted in your totals.'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: closeSheet }, 'Close'),
      C.isActive(item) && h('button', { type: 'button', class: 'btn primary', onclick: () => { item.active = false; save(); render(); closeSheet(); toast(`${item.name} paused.`); } }, 'Pause it instead')));
  openSheet('What if I cancel this?', body);
}

/* ----- price change form ----- */
function submitPrice(e) {
  e.preventDefault();
  const err = $('#p-error');
  const item = state.items.find((x) => x.id === $('#p-item').value);
  const oldCost = parseMoney($('#p-old').value); const newCost = parseMoney($('#p-new').value);
  const date = $('#p-date').value;
  const msg = !item ? 'Choose an item.' : !date ? 'Enter a date.' : !(oldCost > 0) ? 'Old cost must be greater than 0.'
    : !(newCost > 0) ? 'New cost must be greater than 0.' : oldCost === newCost ? 'The new cost is the same as the old cost.' : '';
  err.textContent = msg;
  if (msg) return;
  state.priceChanges.push(normalisePriceChange({ id: newId(), date, itemId: item.id, oldCost, newCost }));
  if ($('#p-apply').checked) item.cost = newCost;
  save(); $('#p-new').value = ''; $('#p-old').value = String(item.cost); render();
  toast($('#p-apply').checked ? `Logged. ${item.name} is now ${formatMoney(newCost)}.` : 'Price change logged.');
}

/* ============================ IMPORT / EXPORT ========================== */
async function handleImportFile(file) {
  let parsed;
  try { parsed = parseImportFile(await file.text(), file.name); } catch (e) { toast('Could not import: ' + e.message); return; }
  const problems = parsed.errors.length
    ? h('div', null, h('p', null, `${parsed.errors.length} of ${parsed.total} row${parsed.total === 1 ? '' : 's'} failed validation and will be skipped:`),
      h('ul', { class: 'problems' }, parsed.errors.slice(0, 12).map((x) => h('li', null, `Row ${x.row}${x.name ? ` (${x.name})` : ''}: ${x.message}`)),
        parsed.errors.length > 12 && h('li', null, `…and ${parsed.errors.length - 12} more`))) : null;
  if (!parsed.items.length && !(parsed.oneOffs.length || parsed.savingsGoals.length)) { await ask('Nothing to import', h('div', null, h('p', null, 'No valid items were found.'), problems), [{ label: 'OK', value: 'ok' }]); return; }
  const n = parsed.items.length;
  const content = h('div', null, h('p', null, `Found ${n} valid item${n === 1 ? '' : 's'}. Merge adds new items and updates ones with the same name. Replace deletes your current ${state.items.length} items first.`), problems);
  const choice = await ask('Import data', content, [{ label: 'Cancel', value: '', kind: 'ghost' }, { label: 'Merge', value: 'merge' }, { label: 'Replace', value: 'replace', kind: 'danger' }]);
  if (!choice) return;
  if (choice === 'replace') {
    state.items = parsed.items; state.priceChanges = parsed.priceChanges;
    state.oneOffs = parsed.oneOffs; state.savingsGoals = parsed.savingsGoals; state.savingsTxns = parsed.savingsTxns;
    if (parsed.settings) state.settings = normaliseSettings({ ...parsed.settings, theme: state.settings.theme });
  } else {
    mergeItems(state.items, parsed.items);
    const addNew = (target, incoming) => incoming.forEach((x) => { if (!target.some((y) => y.id === x.id)) target.push(x); });
    addNew(state.oneOffs, parsed.oneOffs); addNew(state.savingsGoals, parsed.savingsGoals);
    addNew(state.savingsTxns, parsed.savingsTxns.filter((t) => state.savingsGoals.some((g) => g.id === t.goalId)));
    parsed.priceChanges.forEach((c) => { if (!state.priceChanges.some((x) => x.id === c.id) && state.items.some((i) => i.id === c.itemId)) state.priceChanges.push(c); });
  }
  save(); render();
  toast(`Imported ${n} item${n === 1 ? '' : 's'} (${choice})${parsed.errors.length ? `, ${parsed.errors.length} skipped` : ''}.`);
}

function openBankImport() {
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', id: 'bank-file' });
  const body = h('div', null, h('p', { class: 'muted' }, 'Pick a CSV from your bank. It is read on this device only and never uploaded.'),
    h('label', { class: 'btn block file-btn', for: 'bank-file' }, 'Choose bank CSV…'), fileInput);
  openSheet('Bank statement import', body);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    const rows = parseCSV(await file.text());
    if (rows.length < 2) { toast('That file looks empty.'); return; }
    bankMapStep(rows.shift(), rows);
  });
}
function bankMapStep(headers, rows) {
  const saved = state.settings.bankMapping;
  const auto = detectColumns(headers);
  const idx = (name, fallback) => { const i = saved && saved[name] ? headers.indexOf(saved[name]) : -1; return i >= 0 ? i : fallback; };
  const pick = (id, label, init) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('select', { id }, h('option', { value: '-1' }, '— choose —'), headers.map((x, i) => h('option', { value: i, selected: i === init }, x || `Column ${i + 1}`))));
  const body = h('div', null, h('p', { class: 'muted' }, `${rows.length} rows. Check the columns we guessed.`),
    pick('bk-date', 'Date column', idx('date', auto.date)), pick('bk-desc', 'Description column', idx('desc', auto.desc)), pick('bk-amt', 'Amount column', idx('amount', auto.amount)),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => {
        const m = { date: +$('#bk-date').value, desc: +$('#bk-desc').value, amount: +$('#bk-amt').value };
        if (Object.values(m).some((v) => v < 0)) { toast('Choose all three columns.'); return; }
        state.settings.bankMapping = { date: headers[m.date], desc: headers[m.desc], amount: headers[m.amount] }; save();
        const found = findRecurring(readTransactions(rows, m), state.items);
        bankResultsStep(found, readTransactions(rows, m).length);
      } }, 'Find recurring charges')));
  openSheet('Bank statement import', body);
}
function bankResultsStep(found, txCount) {
  if (!found.length) {
    openSheet('Bank statement import', h('div', null, h('p', null, `No new recurring charges found in ${txCount} transactions. A charge needs at least 3 payments, evenly spaced (weekly, fortnightly, monthly, quarterly or yearly) with amounts within 10%.`),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: closeSheet }, 'Close'))));
    return;
  }
  const boxes = found.map((f, i) => h('label', { class: 'check suggestion' }, h('input', { type: 'checkbox', checked: true, 'data-i': i }),
    h('span', null, h('strong', null, f.name), h('br'), `${formatMoney(f.cost)} every ${f.period.toLowerCase()} · ${f.count} charges · last ${formatDate(f.paymentDate)}`)));
  const body = h('div', null, h('p', { class: 'muted' }, `Found ${found.length} likely recurring charge${found.length === 1 ? '' : 's'}.`), boxes,
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => {
        let added = 0;
        boxes.forEach((b, i) => {
          if (!b.querySelector('input').checked) return;
          const f = found[i];
          const r = normaliseItem({ name: f.name, cost: f.cost, every: f.every, period: f.period, paymentDate: f.paymentDate });
          if (r.item) { state.items.push(r.item); added++; }
        });
        save(); render(); closeSheet(); toast(`Added ${added} item${added === 1 ? '' : 's'}.`);
      } }, 'Add selected')));
  openSheet('Bank statement import', body);
}

/* ============================== REMINDERS ============================== */
async function toggleNotify() {
  if (!('Notification' in window)) return;
  if (state.settings.notify && Notification.permission === 'granted') { state.settings.notify = false; save(); renderNotifyUI(); return; }
  const perm = await Notification.requestPermission();
  state.settings.notify = perm === 'granted'; save(); renderNotifyUI();
  if (perm === 'granted') { toast('Notifications on.'); notifyAlerts(); }
}
async function notifyAlerts() {
  if (!state.settings.notify || !featureOn('alerts') || !('Notification' in window) || Notification.permission !== 'granted') return;
  const alerts = C.currentAlerts(state.items, T(), state.settings.alertDays);
  if (!alerts.length) return;
  const title = `${alerts.length} budget alert${alerts.length === 1 ? '' : 's'}`;
  const body = alerts.slice(0, 4).map((a) => `${a.item.name}: ${a.label.toLowerCase()} (${dueText(a.days)})`).join('\n');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png' }); else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch (e) { /* notifications are best-effort */ }
}

/* ============================ EVENT HANDLERS =========================== */
function bindEvents() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
  $('#alert-banner').addEventListener('click', () => { state.tab = 'dashboard'; render(); window.scrollTo(0, 0); });
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const pt = t.closest('.period-toggle button[data-period]');
    if (pt) { state.settings.view = pt.dataset.period; save(); render(); return; }
    const find = (attr) => { const el = t.closest(`[${attr}]`); return el ? state.items.find((x) => x.id === el.getAttribute(attr)) : null; };
    const ed = t.closest('[data-edit]');
    if (ed) { openForm(ed.dataset.edit); return; }
    const tg = find('data-toggle');
    if (tg) { tg.active = !C.isActive(tg); save(); render(); toast(tg.active ? `${tg.name} resumed.` : `${tg.name} paused.`); return; }
    const wi = find('data-whatif');
    if (wi) { openWhatIf(wi); return; }
    const del = find('data-delete');
    if (del && await confirmDanger('Delete item?', `“${del.name}” will be removed.`, 'Delete')) {
      state.items = state.items.filter((x) => x.id !== del.id); state.priceChanges = state.priceChanges.filter((c) => c.itemId !== del.id);
      save(); render(); toast('Item deleted.'); return;
    }
    const se = t.closest('[data-spend-edit]');
    if (se) { const sp = state.oneOffs.find((x) => x.id === se.dataset.spendEdit); if (sp) startSpendEdit(sp); return; }
    const sd = t.closest('[data-spend-del]');
    if (sd) {
      const sp = state.oneOffs.find((x) => x.id === sd.dataset.spendDel);
      if (sp && await confirmDanger('Delete spend?', `“${sp.name}” (${formatMoney(sp.amount)}) will be removed.`, 'Delete')) {
        state.oneOffs = state.oneOffs.filter((x) => x.id !== sp.id); if (state.editingSpendId === sp.id) endSpendEdit(); save(); render();
      }
      return;
    }
    const goalOf = (attr) => { const el = t.closest(`[${attr}]`); return el ? state.savingsGoals.find((g) => g.id === el.getAttribute(attr)) : null; };
    const gi = goalOf('data-goal-in'); if (gi) { openGoalMoney(gi, 'in'); return; }
    const go = goalOf('data-goal-out'); if (go) { openGoalMoney(go, 'out'); return; }
    const ge = goalOf('data-goal-edit'); if (ge) { openGoalEdit(ge); return; }
    const td = t.closest('[data-txn-del]');
    if (td && await confirmDanger('Delete entry?', 'This removes the deposit or withdrawal from the goal.', 'Delete')) {
      state.savingsTxns = state.savingsTxns.filter((x) => x.id !== td.dataset.txnDel); save(); render(); return;
    }
    const cd = t.closest('[data-cat-del]');
    if (cd) {
      const name = state.settings.categories[Number(cd.dataset.catDel)];
      const used = state.items.filter((it) => it.category === name).length + state.oneOffs.filter((x) => x.category === name).length;
      if (await confirmDanger(`Remove “${name}”?`, used ? `${used} item${used === 1 ? '' : 's'} and spend${used === 1 ? '' : 's'} use it and will become uncategorised.` : 'No items or spends use this category.', 'Remove')) {
        state.settings.categories = state.settings.categories.filter((c) => c !== name);
        state.items.forEach((it) => { if (it.category === name) it.category = ''; }); state.oneOffs.forEach((x) => { if (x.category === name) x.category = ''; });
        if (state.fCat === name) state.fCat = '';
        save(); render(); toast(`Removed ${name}.`);
      }
      return;
    }
    const pa = t.closest('[data-price-apply]');
    if (pa) {
      const c = state.priceChanges.find((x) => x.id === pa.dataset.priceApply); const it = c && state.items.find((x) => x.id === c.itemId);
      if (it) { it.cost = c.newCost; save(); render(); toast(`${it.name} cost updated to ${formatMoney(c.newCost)}.`); }
      return;
    }
    const pd = t.closest('[data-price-delete]');
    if (pd && await confirmDanger('Delete price change?', 'This only removes the log entry, not the item.', 'Delete')) {
      state.priceChanges = state.priceChanges.filter((c) => c.id !== pd.dataset.priceDelete); save(); render();
    }
  });
  $('#fab').addEventListener('click', () => openForm(null));
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderItems(T()); });
  const filt = (id, key, prop = 'value') => $(id).addEventListener('change', (e) => { state[key] = e.target[prop]; renderItems(T()); });
  filt('#sort', 'sort'); filt('#flt-cat', 'fCat'); filt('#flt-type', 'fType'); filt('#flt-status', 'fStatus'); filt('#flt-due', 'fDue', 'checked');

  const form = $('#item-form');
  form.addEventListener('submit', submitForm); form.addEventListener('input', updatePreview);
  $('#form-cancel').addEventListener('click', () => $('#form-dialog').close());

  $('#spend-form').addEventListener('submit', submitSpend);
  $('#sp-cancel').addEventListener('click', () => { endSpendEdit(); $('#sp-error').textContent = ''; });
  $('#goal-form').addEventListener('submit', submitGoal);

  $('#price-form').addEventListener('submit', submitPrice);
  $('#p-item').addEventListener('change', (e) => {
    const it = state.items.find((x) => x.id === e.target.value);
    $('#p-old').value = it ? String(it.cost) : ''; $('#p-new').value = ''; if (it) $('#p-new').focus();
  });

  // Settings
  const num = (id, fn) => $(id).addEventListener('change', () => { fn($(id).value.trim()); state.settings = normaliseSettings(state.settings); save(); render(); });
  num('#s-inc-amount', (v) => { state.settings.income.amount = v === '' ? 0 : parseMoney(v); });
  num('#s-inc-every', (v) => { state.settings.income.every = Number(v) || 1; });
  num('#s-inc-period', (v) => { state.settings.income.period = v; });
  num('#s-alert', (v) => { state.settings.alertDays = Number(v); });
  num('#s-lump', (v) => { state.settings.lumpDays = Number(v); });
  num('#s-look', (v) => { state.settings.lookbackDays = Number(v); });
  $('#cat-list').addEventListener('change', (e) => {
    const i = Number(e.target.dataset.cat); const old = state.settings.categories[i]; const name = e.target.value.trim();
    if (!name || state.settings.categories.some((c, j) => j !== i && c.toLowerCase() === name.toLowerCase())) { e.target.value = old; toast('Category names must be unique and not blank.'); return; }
    state.settings.categories[i] = name;
    state.items.forEach((it) => { if (it.category === old) it.category = name; });
    state.oneOffs.forEach((x) => { if (x.category === old) x.category = name; });
    save(); render();
  });
  $('#cat-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#cat-new').value.trim().slice(0, 40); const cats = state.settings.categories;
    if (!name) { toast('Enter a category name.'); return; }
    if (cats.some((c) => c.toLowerCase() === name.toLowerCase())) { toast('That category already exists.'); return; }
    if (cats.length >= MAX_CATEGORIES) { toast(`You can have up to ${MAX_CATEGORIES} categories.`); return; }
    cats.push(name); $('#cat-new').value = ''; save(); render(); toast(`Added ${name}.`);
  });
  $('#feature-list').addEventListener('change', (e) => {
    const key = e.target.dataset.feature;
    if (!key) return;
    state.settings.features[key] = e.target.checked; save(); render();
  });
  document.querySelectorAll('#theme-toggle button').forEach((b) => b.addEventListener('click', () => { state.settings.theme = b.dataset.theme; save(); applyTheme(); renderSettings(); }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  $('#export-json').addEventListener('click', () => download('budget-tracker.json', 'application/json', store.export(state)));
  $('#export-csv').addEventListener('click', () => download('budget-tracker.csv', 'text/csv', itemsToCSV(state.items)));
  $('#export-ics').addEventListener('click', () => {
    const ics = buildICS(state.items, T(), state.settings.alertDays, new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''));
    const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
    if (!n) { toast('Add payment dates to active items first.'); return; }
    download('budget-payments.ics', 'text/calendar', ics); toast(`Exported ${n} payments. Open the file to add them to your calendar.`);
  });
  $('#notify-btn').addEventListener('click', toggleNotify);
  $('#import-file').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await handleImportFile(f); });
  $('#bank-import').addEventListener('click', openBankImport);
  $('#load-example').addEventListener('click', async () => {
    if (await confirmDanger('Load example data?', 'This replaces all items and price changes with the example set. Your income and settings are kept.', 'Replace')) {
      state.items = seedItems(); state.priceChanges = []; save(); render(); toast('Example data loaded.');
    }
  });
  $('#clear-all').addEventListener('click', async () => {
    if (await confirmDanger('Clear all data?', 'Every item, price change and setting will be permanently deleted from this device.', 'Clear all')) {
      const theme = state.settings.theme;
      Object.assign(state, emptyData()); state.settings.theme = theme; save(); render(); toast('All data cleared.');
    }
  });
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); }); // new day -> refresh dates
}

/* ============================ SERVICE WORKER =========================== */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const showUpdate = (worker) => {
    $('#update-bar').hidden = false;
    $('#update-reload').onclick = () => worker.postMessage('SKIP_WAITING');
  };
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w); });
    });
  }).catch((e) => console.warn('SW registration failed', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && document.querySelector('#update-bar').hidden === false) { reloading = true; location.reload(); } });
}

function init() {
  loadState(); applyTheme(); bindEvents(); render(); registerServiceWorker(); notifyAlerts();
}
init();
