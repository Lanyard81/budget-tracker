// Test suite shared by tests.html (browser) and scripts/run-tests.mjs (Node). today = 2026-10-04 throughout.
import * as C from './calc.js';
import { seedItems, normaliseItem, mergeItems, normaliseSettings, normaliseSpend, normaliseGoal, normaliseTxn } from './model.js';
import { addDays } from './dates.js';
import { createStorage, migrate } from './storage.js';
import { itemsToCSV, parseItemsCSV, parseImportFile, CSV_HEADERS } from './csv.js';
import { detectColumns, readTransactions, findRecurring, normaliseDescription } from './bank.js';
import { parseCSV } from './csv.js';
import { buildICS } from './ics.js';
import { STORAGE_KEY } from './constants.js';

const TODAY = '2026-10-04';

function memoryBackend(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), map: m };
}

export function runTests() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: ok ? '' : String(detail) });
  const money = (name, actual, expected) => check(name, Math.abs(actual - expected) < 0.0051, `got ${actual}, expected ${expected}`);
  const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  const byName = (items, n) => items.find((i) => i.name === n);

  /* ---------- Fixture A: seed data ---------- */
  const A = seedItems();
  const tA = C.totalCosts(A);
  money('A weekly', tA.Week, 365.18); money('A fortnightly', tA.Fortnight, 730.37); money('A monthly', tA.Month, 1582.46);
  money('A quarterly', tA.Quarter, 4747.39); money('A yearly', tA.Year, 18989.55);
  const cat = C.breakdownByCategory(A, ['Streaming', 'Subscriptions', 'Pets', 'Household', 'Health & personal', 'Insurance', 'Utilities', 'Food & groceries', 'Transport', 'Other'], 0);
  const row = (n) => cat.rows.find((r) => r.name === n);
  money('A Streaming', row('Streaming').yearly, 1314.40); money('A Pets', row('Pets').yearly, 12437.59);
  money('A Household', row('Household').yearly, 125.88); money('A Health & personal', row('Health & personal').yearly, 128.00);
  money('A Uncategorised', row('Uncategorised / other').yearly, 4983.68);
  money('A category total', cat.total.yearly, 18989.55);
  const ty = C.breakdownByType(A, 0).rows;
  money('A Need', ty[0].yearly, 7363.47); money('A Want', ty[1].yearly, 1314.40); money('A Untagged', ty[2].yearly, 10311.68);
  const top = C.topItems(A, 5);
  eq('A top 5 order', top.map((t) => t.item.name), ['Fred Walks', 'Fah', 'Fred Insurance', 'Catfood', 'Lyka']);
  [5200, 3640, 2040.74, 1871.48, 1547].forEach((v, i) => money('A top ' + (i + 1) + ' yearly', top[i].yearly, v));
  const sfA = C.sinkingFund(A, TODAY, 60);
  money('A sinking set-aside per fortnight', sfA.setAsidePerFortnight, 12.80);
  eq('A lump-sum items', sfA.count, 4);
  money('A Prime fortnightly', C.periodAmount(byName(A, 'Amazon Prime'), 'Fortnight'), 3.04);
  money('A Dermaveen fortnightly', C.periodAmount(byName(A, 'Dermaveen'), 'Fortnight'), 4.92);
  check('A has no income -> not shown', !C.hasIncome({ amount: 0, every: 1, period: 'Fortnight' }));
  eq('A no dated items: no next due', A.map((i) => C.nextDue(i, TODAY)).filter(Boolean).length, 0);

  /* ---------- Fixture B ---------- */
  const B = seedItems();
  const set = (n, patch) => Object.assign(byName(B, n), patch);
  set('Netflix', { share: 0.5, paymentDate: '2026-09-17' }); set('Stan', { active: false, paymentDate: '2026-10-10' });
  set('Amazon Prime', { paymentDate: '2025-12-20' }); set('Disney+', { paymentDate: '2025-01-31' });
  set('HBO', { paymentDate: '2026-10-28', trialEnds: '2026-10-06' }); set('Fred Walks', { paymentDate: '2026-09-25' });
  set('Freds Pills', { paymentDate: '2026-08-20' }); set('Dermaveen', { paymentDate: '2026-07-15' });
  set('Lyka', { paymentDate: '2026-10-04' }); set('Kleenex', { paymentDate: '2027-01-05' });
  const income = { amount: 2000, every: 1, period: 'Fortnight' };
  const netflix = byName(B, 'Netflix');
  const changes = [{ id: 'c1', date: addDays(TODAY, -30), itemId: netflix.id, oldCost: 33.98, newCost: 37.98 }];
  const tB = C.totalCosts(B);
  money('B yearly', tB.Year, 18473.79); money('B weekly', tB.Week, 355.27); money('B fortnightly', tB.Fortnight, 710.53);
  money('B monthly', tB.Month, 1539.48); money('B quarterly', tB.Quarter, 4618.45);
  const incY = C.incomeYearly(income);
  money('B income per year', incY, 52000);
  money('B left over per fortnight', C.leftOver(tB.Year, incY).Fortnight, 1289.47);
  check('B % income spent 35.5%', Math.abs(C.pctOfIncomeSpent(tB.Year, incY) * 100 - 35.5) < 0.05, C.pctOfIncomeSpent(tB.Year, incY));
  money('B paused saves/year', C.pausedSavesPerYear(B), 287.88);
  eq('B active count', B.filter(C.isActive).length, 16); eq('B paused count', B.filter((i) => !C.isActive(i)).length, 1);
  const due = (n) => C.nextDue(byName(B, n), TODAY);
  eq('B next due Prime', due('Amazon Prime'), '2026-12-20'); eq('B next due Netflix', due('Netflix'), '2026-10-17');
  eq('B next due Disney+', due('Disney+'), '2026-10-31'); eq('B next due Stan', due('Stan'), '2026-10-10');
  eq('B next due HBO', due('HBO'), '2026-10-28'); eq('B next due Fred Walks', due('Fred Walks'), '2026-10-09');
  eq('B next due Freds Pills', due('Freds Pills'), '2026-10-08'); eq('B next due Dermaveen', due('Dermaveen'), '2026-10-15');
  eq('B next due Lyka', due('Lyka'), '2026-10-04'); eq('B Lyka 0 days', C.daysUntil(byName(B, 'Lyka'), TODAY), 0);
  eq('B next due Kleenex', due('Kleenex'), '2027-01-05');
  const alerts = C.currentAlerts(B, TODAY, 3).map((a) => [a.item.name, a.label]);
  eq('B alerts', alerts, [['Lyka', 'Due soon'], ['HBO', 'Trial ends soon']]);
  check('B trial takes priority over due', C.alertFor(byName(B, 'HBO'), TODAY, 3) === 'Trial ends soon');
  check('B paused item never alerts', C.alertFor(byName(B, 'Stan'), TODAY, 30) === null);
  const cash = (d) => C.cashNeeded(B, TODAY, d);
  eq('B cash 7 payments', cash(7).payments, 3); money('B cash 7 $', cash(7).total, 420.84);
  eq('B cash 14 payments', cash(14).payments, 5); money('B cash 14 $', cash(14).total, 471.83);
  eq('B cash 30 payments', cash(30).payments, 8); money('B cash 30 $', cash(30).total, 712.81);
  const pr = C.priceRises(changes, B, TODAY, 365);
  eq('B price-rise items', pr.count, 1); money('B price-rise impact', pr.yearlyImpact, 24.00);
  check('B price change outside look-back ignored', C.priceRises([{ ...changes[0], date: addDays(TODAY, -400) }], B, TODAY, 365).count === 0);
  check('B price fall is not a rise', C.priceRises([{ ...changes[0], oldCost: 40, newCost: 37.98 }], B, TODAY, 365).count === 0);
  money('B sinking should-have-saved', C.sinkingFund(B, TODAY, 60).shouldHaveSavedTotal, 90.42);
  eq('B upcoming order', C.upcomingPayments(B, TODAY, 10).map((u) => u.item.name),
    ['Lyka', 'Freds Pills', 'Fred Walks', 'Dermaveen', 'Netflix', 'HBO', 'Disney+', 'Amazon Prime', 'Kleenex']);
  const fc = C.forecast12(B, TODAY);
  money('B forecast 1', fc.windows[0].total, 1580.00); money('B forecast 2', fc.windows[1].total, 1548.00); money('B forecast 3', fc.windows[2].total, 1784.66);
  eq('B forecast has 12 windows', fc.windows.length, 12);
  eq('B forecast window 1 dates', [fc.windows[0].start, fc.windows[0].end], ['2026-10-04', '2026-11-03']);
  money('B forecast total = sum', fc.total, fc.windows.reduce((s, w) => s + w.total, 0));

  /* ---------- date maths ---------- */
  const mk = (period, paymentDate, every = 1) => ({ cost: 10, every, period, paymentDate });
  eq('month-end: 31 Jan -> 28 Feb', C.nextDue(mk('Month', '2026-01-31'), '2026-02-01'), '2026-02-28');
  eq('month-end: then 31 Mar (anchored to original)', C.nextDue(mk('Month', '2026-01-31'), '2026-03-01'), '2026-03-31');
  eq('month-end: then 30 Apr', C.nextDue(mk('Month', '2026-01-31'), '2026-04-01'), '2026-04-30');
  eq('leap year: 31 Jan -> 29 Feb 2028', C.nextDue(mk('Month', '2028-01-31'), '2028-02-01'), '2028-02-29');
  eq('leap day yearly -> 28 Feb 2026', C.nextDue(mk('Year', '2024-02-29'), '2025-03-01'), '2026-02-28');
  eq('leap day yearly -> 29 Feb 2028', C.nextDue(mk('Year', '2024-02-29'), '2027-03-01'), '2028-02-29');
  eq('quarterly every 2 (6 months)', C.nextDue(mk('Quarter', '2026-01-15', 2), '2026-10-04'), '2027-01-15');
  eq('anchor equal to today', C.nextDue(mk('Week', '2026-10-04'), TODAY), '2026-10-04');
  eq('anchor in the future', C.nextDue(mk('Month', '2027-03-09'), TODAY), '2027-03-09');
  eq('no payment date', C.nextDue(mk('Month', ''), TODAY), null);
  eq('fortnight rolls forward', C.nextDue(mk('Fortnight', '2026-09-25'), TODAY), '2026-10-09');
  eq('every 7 weeks rolls forward', C.nextDue(mk('Week', '2026-08-20', 7), TODAY), '2026-10-08');
  eq('day before anchor (future) is anchor', C.nextDue(mk('Week', '2026-10-05'), TODAY), '2026-10-05');
  eq('payments in window (weekly, inclusive ends)', C.paymentDates(mk('Week', '2026-10-04'), '2026-10-04', '2026-10-18'), ['2026-10-04', '2026-10-11', '2026-10-18']);
  eq('payments never precede a future anchor', C.paymentDates(mk('Week', '2026-10-20'), '2026-10-04', '2026-11-01'), ['2026-10-20', '2026-10-27']);

  /* ---------- model / import / CSV ---------- */
  check('normaliseItem rejects blank name', !!normaliseItem({ name: ' ', cost: 5, period: 'Month' }).error);
  check('normaliseItem rejects cost 0', !!normaliseItem({ name: 'x', cost: 0, period: 'Month' }).error);
  check('normaliseItem rejects every 0', !!normaliseItem({ name: 'x', cost: 5, every: 0, period: 'Month' }).error);
  check('normaliseItem rejects share 150%', !!normaliseItem({ name: 'x', cost: 5, period: 'Month', share: '150%' }).error);
  eq('share 50% parses', normaliseItem({ name: 'x', cost: 5, period: 'Month', share: '50%' }).item.share, 0.5);
  eq('share 0.5 parses', normaliseItem({ name: 'x', cost: 5, period: 'Month', share: '0.5' }).item.share, 0.5);
  const csv = itemsToCSV(B);
  eq('CSV header exact', csv.replace(/^﻿/, '').split('\r\n')[0], 'Item,Cost,Every,Period,Category,Need/Want,My share,Active,Payment date,Trial ends,Notes,Link');
  eq('CSV_HEADERS constant', CSV_HEADERS.length, 12);
  const rt = parseItemsCSV(csv);
  eq('CSV round trip: no errors', rt.errors.length, 0); eq('CSV round trip: count', rt.items.length, B.length);
  const strip = (i) => ({ ...i, id: '' });
  eq('CSV round trip: identical items', rt.items.map(strip), B.map(strip));
  money('CSV round trip: yearly total', C.totalCosts(rt.items).Year, tB.Year);
  const odd = parseItemsCSV('Item,Cost,Every,Period,Category,Need/Want,My share,Active,Payment date,Trial ends,Notes,Link\r\n' +
    'A,10,1,Month,Pets,Need,50%,No,5/1/2027,4 Oct 2026,"has, comma",\r\nB,0,1,Month,,,,,,,,\r\nC,5,1,Month,,,,,31/02/2026,,,\r\nD,5,1,Month,,,0.25,Yes,2026-10-04,,,\r\n');
  eq('import: 2 valid, 2 reported', [odd.items.length, odd.errors.length], [2, 2]);
  eq('import: error rows numbered like the sheet', odd.errors.map((e) => e.row), [3, 4]);
  eq('import: D/M/YYYY', odd.items[0].paymentDate, '2027-01-05'); eq('import: D MMM YYYY', odd.items[0].trialEnds, '2026-10-04');
  eq('import: Active No', odd.items[0].active, false); eq('import: comma in notes', odd.items[0].notes, 'has, comma');
  eq('import: 0.25 share', odd.items[1].share, 0.25);
  let threw = false; try { parseItemsCSV('foo,bar\n1,2'); } catch (e) { threw = true; }
  check('import: missing columns throws', threw);
  const json = parseImportFile(JSON.stringify({ items: B, priceChanges: changes }), 'x.json');
  eq('JSON import: items + price changes', [json.items.length, json.priceChanges.length], [B.length, 1]);
  const m = seedItems(); const mr = mergeItems(m, [{ ...m[0], cost: 99 }, normaliseItem({ name: 'New thing', cost: 5, period: 'Week' }).item]);
  eq('merge: matches by name, adds new', [mr.updated, mr.added, m.length, m[0].cost], [1, 1, 18, 99]);

  /* ---------- storage ---------- */
  const be = memoryBackend();
  const store = createStorage(be);
  const first = store.get();
  eq('storage: first run seeds', [first.status, first.data.items.length], ['missing', 17]);
  store.set({ ...first.data, items: B, priceChanges: changes });
  const second = createStorage(be).get();
  eq('storage: round trip', [second.status, second.data.items.length, second.data.priceChanges.length], ['ok', 17, 1]);
  const bad = createStorage(memoryBackend({ [STORAGE_KEY]: '{not json' })).get();
  eq('storage: corrupted JSON handled', [bad.status, bad.data.items.length], ['corrupt', 0]);
  const bad2 = createStorage(memoryBackend({ [STORAGE_KEY]: '"a string"' })).get();
  eq('storage: wrong shape handled', bad2.status, 'corrupt');
  const bad3 = createStorage(memoryBackend({ [STORAGE_KEY]: JSON.stringify({ items: 'nope', settings: 5 }) })).get();
  eq('storage: bad fields fall back', [bad3.status, bad3.data.items.length, bad3.data.settings.alertDays], ['ok', 0, 3]);
  const keepCorrupt = memoryBackend({ [STORAGE_KEY]: '{oops' }); createStorage(keepCorrupt).get();
  check('storage: raw corrupt copy kept', keepCorrupt.map.get(STORAGE_KEY + ':corrupt') === '{oops');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  check('storage: unavailable handled', createStorage(throwing).get().status === 'unavailable' && createStorage(throwing).set({ items: [] }) === false);
  const v1 = migrate({ schema: 1, items: [{ id: 'a', name: 'Old', cost: 10, every: 1, period: 'Month' }], settings: { theme: 'dark', view: 'Week' } });
  eq('migrate: v1 -> v2 keeps data, adds defaults', [v1.schema, v1.items[0].active, v1.items[0].share, v1.settings.theme, v1.settings.view, v1.settings.categories.length], [3, true, 1, 'dark', 'Week', 10]);

  /* ---------- bank import ---------- */
  eq('bank: detect columns', detectColumns(['Transaction Date', 'Narrative', 'Debit Amount', 'Balance']), { date: 0, desc: 1, amount: 2 });
  eq('bank: normalise description', normaliseDescription('NETFLIX.COM 88123 SYDNEY AU Visa Purchase Card xx1234'), 'netflix sydney');
  const rows = parseCSV('Date,Description,Amount\n' + [
    '04/06/2026,NETFLIX.COM 1111,-16.99', '04/07/2026,NETFLIX.COM 2222,-16.99', '04/08/2026,NETFLIX.COM 3333,-16.99', '04/09/2026,NETFLIX.COM 4444,-17.49',
    '01/07/2026,GYM CLUB 99,-45', '15/07/2026,GYM CLUB 98,-45', '29/07/2026,GYM CLUB 97,-45', '12/08/2026,GYM CLUB 96,-46',
    '01/07/2026,COLES 1234,-60', '09/07/2026,COLES 5678,-95', '14/07/2026,COLES 9999,-20',
    '10/09/2026,SALARY,2000',
    '04/06/2026,SPOTIFY 1,-12.99', '04/07/2026,SPOTIFY 2,-12.99', '04/08/2026,SPOTIFY 3,-12.99',
  ].join('\n')).slice(1);
  const tx = readTransactions(rows, { date: 0, desc: 1, amount: 2 });
  eq('bank: credits ignored, amounts absolute', [tx.length, tx.every((t) => t.amount > 0)], [14, true]);
  const found = findRecurring(tx, [{ name: 'Spotify' }]);
  eq('bank: recurring found, existing item skipped, irregular ignored', found.map((f) => [f.name, f.period]), [['Gym Club', 'Fortnight'], ['Netflix', 'Month']]);
  const nf = found.find((f) => f.name === 'Netflix');
  eq('bank: median amount + latest date', [nf.cost, nf.paymentDate, nf.count], [16.99, '2026-09-04', 4]);
  const loose = findRecurring(readTransactions(parseCSV('Date,Description,Amount\n01/01/2026,X,-10\n01/02/2026,X,-10\n01/03/2026,X,-30').slice(1), { date: 0, desc: 1, amount: 2 }));
  eq('bank: amounts beyond 10% rejected', loose.length, 0);

  /* ---------- calendar export ---------- */
  const ics = buildICS(B, TODAY, 3);
  check('ics: calendar wrapper', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
  check('ics: VALARM with alertDays', ics.includes('BEGIN:VALARM') && ics.includes('TRIGGER:-P3D'));
  check('ics: CRLF line endings', !/[^\r]\n/.test(ics));
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  check('ics: many events, paused item excluded', events > 40 && !ics.includes('SUMMARY:Stan'), events);
  check('ics: Lyka today included', ics.includes('DTSTART;VALUE=DATE:20261004'));

  /* ---------- categories, features, one-offs, savings ---------- */
  eq('categories: any number, deduped case-insensitively', normaliseSettings({ categories: ['A', 'B', 'a', ' ', 'C'] }).categories, ['A', 'B', 'C']);
  eq('categories: can be emptied', normaliseSettings({ categories: [] }).categories, []);
  eq('categories: default set when missing', normaliseSettings({}).categories.length, 10);
  eq('features: default all on', Object.values(normaliseSettings({}).features).every(Boolean), true);
  const ff = normaliseSettings({ features: { savings: false, oneOffs: 'no' } }).features;
  eq('features: saved flags kept, junk ignored', [ff.savings, ff.oneOffs], [false, true]);
  const v2 = migrate({ schema: 2, items: [], priceChanges: [], settings: {} });
  eq('migrate: v2 -> v3 adds empty one-offs/savings and features', [v2.schema, v2.oneOffs, v2.savingsGoals, v2.savingsTxns, v2.settings.features.savings], [3, [], [], [], true]);
  check('one-off: validates', normaliseSpend({ name: 'x', amount: 0, date: '2026-10-01' }) === null && normaliseSpend({ name: 'x', amount: 5, date: 'nope' }) === null && normaliseSpend({ name: 'x', amount: '5.50', date: '1/10/2026' }).date === '2026-10-01');
  const spends = [
    { date: '2026-10-02', amount: 50, category: 'Food & groceries' }, { date: '2026-10-04', amount: 25.5, category: '' },
    { date: '2026-09-30', amount: 100, category: 'Pets' }, { date: '2026-01-15', amount: 200, category: 'Pets' }, { date: '2026-10-20', amount: 999, category: 'Pets' },
  ];
  const os = C.oneOffSummary(spends, TODAY, normaliseSettings({}).categories);
  money('one-off: this month (future-dated ignored)', os.thisMonth, 75.5); money('one-off: last 30 days', os.last30, 175.5); money('one-off: year to date', os.ytd, 375.5);
  eq('one-off: month categories', os.byCategory.map((c) => c.name), ['Food & groceries', 'Uncategorised / other']);
  check('goal: validates', normaliseGoal({ name: ' ' }) === null && normaliseGoal({ name: 'Holiday', target: 'abc' }).target === 0 && normaliseTxn({ goalId: 'g', date: '2026-10-01', amount: 0 }) === null);
  const goal = { id: 'g1', name: 'Holiday', target: 1000, targetDate: '2027-01-04' };
  const txns = [{ goalId: 'g1', amount: 300 }, { goalId: 'g1', amount: 200 }, { goalId: 'g1', amount: -50 }, { goalId: 'other', amount: 999 }];
  const gs = C.goalStatus(goal, txns, TODAY);
  money('savings: balance', gs.saved, 450); money('savings: remaining', gs.remaining, 550); money('savings: needed per fortnight', gs.perFortnight, 83.70);
  eq('savings: progress and days left', [Math.round(gs.pct * 100), gs.daysLeft, gs.reached], [45, 92, false]);
  const noTarget = C.goalStatus({ id: 'g2', target: 0 }, [], TODAY);
  eq('savings: no target means no progress or plan', [noTarget.pct, noTarget.perFortnight], [null, null]);
  check('savings: reached', C.goalStatus({ ...goal, target: 400 }, txns, TODAY).reached);
  money('savings: total across goals', C.totalSaved([goal, { id: 'other' }], txns), 1449);
  const full = { items: [], priceChanges: [], oneOffs: [{ id: 'o1', date: '2026-10-01', name: 'Coffee', amount: 4.5, category: '' }], savingsGoals: [goal], savingsTxns: [{ id: 't', goalId: 'g1', date: '2026-10-02', amount: 10 }], settings: normaliseSettings({}) };
  const back = migrate(JSON.parse(createStorage(memoryBackend()).export(full)));
  eq('export/import keeps one-offs and savings', [back.oneOffs.length, back.savingsGoals.length, back.savingsTxns.length], [1, 1, 1]);

  return results;
}
