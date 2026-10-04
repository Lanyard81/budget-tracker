// Calculations: pure functions, no DOM. Every date-dependent function takes `today` (YYYY-MM-DD) as a parameter.
// Nothing here rounds; rounding happens only when formatting for display.
import { PAYMENTS_PER_YEAR, STEP_DAYS, STEP_MONTHS, APPROX_DAYS, PERIODS } from './constants.js';
import { parseISO as D, toISO as I, addMonthsDay, monthsBetweenDays } from './dates.js';

/* ---------- per-item amounts ---------- */
export const shareOf = (it) => (it.share === undefined || it.share === null ? 1 : it.share);
export const isActive = (it) => it.active !== false;
export const yearlyOf = (it) => (it.cost * PAYMENTS_PER_YEAR[it.period]) / it.every * shareOf(it);
export const fromYearly = (yearly, period) => yearly / PAYMENTS_PER_YEAR[period];
export const periodAmount = (it, period) => fromYearly(yearlyOf(it), period);
export const billAmount = (it) => it.cost * shareOf(it); // one payment

function perPeriod(yearly) {
  const out = {};
  PERIODS.forEach((p) => { out[p] = fromYearly(yearly, p); });
  return out;
}

/* ---------- totals (active items only) ---------- */
export const activeItems = (items) => items.filter(isActive);
export const totalYearly = (items) => activeItems(items).reduce((s, it) => s + yearlyOf(it), 0);
export const totalCosts = (items) => perPeriod(totalYearly(items)); // {Week, Fortnight, Month, Quarter, Year}
export const pausedSavesPerYear = (items) => items.filter((it) => !isActive(it)).reduce((s, it) => s + yearlyOf(it), 0);

export function incomeYearly(income) {
  if (!income || !(income.amount > 0)) return 0;
  return (income.amount * PAYMENTS_PER_YEAR[income.period]) / (income.every || 1);
}
export const hasIncome = (income) => incomeYearly(income) > 0;
export function leftOver(costYearly, incYearly) {
  const out = {};
  PERIODS.forEach((p) => { out[p] = fromYearly(incYearly - costYearly, p); });
  return out;
}
export const pctOfIncomeSpent = (costYearly, incYearly) => (incYearly > 0 ? costYearly / incYearly : null);

/* ---------- breakdowns ---------- */
function breakdownRow(name, yearly, totalY, incY) {
  return { name, yearly, ...perPeriod(yearly), pctCosts: totalY > 0 ? yearly / totalY : 0, pctIncome: incY > 0 ? yearly / incY : null };
}
export function breakdownByCategory(items, categories, incY) {
  const act = activeItems(items);
  const totalY = totalYearly(items);
  const sums = new Map(categories.map((c) => [c, 0]));
  let other = 0;
  for (const it of act) {
    if (sums.has(it.category)) sums.set(it.category, sums.get(it.category) + yearlyOf(it)); else other += yearlyOf(it);
  }
  const rows = categories.map((c) => breakdownRow(c, sums.get(c), totalY, incY));
  rows.push(breakdownRow('Uncategorised / other', other, totalY, incY));
  return { rows, total: breakdownRow('Total', totalY, totalY, incY) };
}
export function breakdownByType(items, incY) {
  const act = activeItems(items);
  const totalY = totalYearly(items);
  const sum = (f) => act.filter(f).reduce((s, it) => s + yearlyOf(it), 0);
  const rows = [
    breakdownRow('Need', sum((it) => it.type === 'Need'), totalY, incY),
    breakdownRow('Want', sum((it) => it.type === 'Want'), totalY, incY),
    breakdownRow('Untagged', sum((it) => it.type !== 'Need' && it.type !== 'Want'), totalY, incY),
  ];
  return { rows, total: breakdownRow('Total', totalY, totalY, incY) };
}
export function topItems(items, n = 5) {
  const total = totalYearly(items);
  return activeItems(items).map((it) => ({ item: it, yearly: yearlyOf(it), pct: total ? yearlyOf(it) / total : 0 }))
    .sort((a, b) => b.yearly - a.yearly).slice(0, n);
}

/* ---------- dates & payments ---------- */
// Next payment on/after today, rolled forward from any anchor paymentDate. Month-based periods always add
// months to the ORIGINAL date (clamped to month end) so 31 Jan monthly goes 28 Feb, 31 Mar.
export function nextDue(item, today) {
  if (!item.paymentDate) return null;
  const pd = D(item.paymentDate); const t = D(today);
  if (Number.isNaN(pd) || Number.isNaN(t)) return null;
  if (pd >= t) return item.paymentDate;
  if (STEP_DAYS[item.period]) {
    const step = STEP_DAYS[item.period] * item.every;
    return I(pd + Math.ceil((t - pd) / step) * step);
  }
  const sm = STEP_MONTHS[item.period] * item.every;
  let k = Math.max(0, Math.floor(monthsBetweenDays(pd, t) / sm) - 1); // safe lower bound
  while (addMonthsDay(pd, sm * k) < t) k++;
  return I(addMonthsDay(pd, sm * k));
}
export function daysUntil(item, today) {
  const nd = nextDue(item, today);
  return nd ? D(nd) - D(today) : null;
}
// Every payment date of an item inside [startISO, endISO] inclusive (payments start at the anchor date).
export function paymentDates(item, startISO, endISO) {
  const out = [];
  if (!item.paymentDate) return out;
  const pd = D(item.paymentDate); const s = D(startISO); const e = D(endISO);
  if (Number.isNaN(pd) || e < pd) return out;
  if (STEP_DAYS[item.period]) {
    const step = STEP_DAYS[item.period] * item.every;
    for (let d = pd + Math.max(0, Math.ceil((s - pd) / step)) * step; d <= e; d += step) out.push(I(d));
  } else {
    const sm = STEP_MONTHS[item.period] * item.every;
    for (let k = Math.max(0, Math.floor(monthsBetweenDays(pd, s) / sm) - 1); ; k++) {
      const d = addMonthsDay(pd, sm * k);
      if (d > e) break;
      if (d >= s) out.push(I(d));
    }
  }
  return out;
}

/* ---------- alerts ---------- */
export function alertFor(item, today, alertDays) {
  if (!isActive(item)) return null;
  const t = D(today);
  if (item.trialEnds) {
    const te = D(item.trialEnds);
    if (te >= t && te - t <= alertDays) return 'Trial ends soon';
  }
  const nd = nextDue(item, today);
  if (nd && D(nd) - t <= alertDays) return 'Due soon';
  return null;
}
export function currentAlerts(items, today, alertDays) {
  return activeItems(items).map((item) => ({ item, label: alertFor(item, today, alertDays) })).filter((a) => a.label)
    .map((a) => {
      const target = a.label === 'Trial ends soon' ? a.item.trialEnds : nextDue(a.item, today);
      return { ...a, date: target, days: D(target) - D(today) };
    }).sort((a, b) => a.days - b.days);
}

export function upcomingPayments(items, today, limit = 10) {
  return activeItems(items).map((item) => ({ item, due: nextDue(item, today) })).filter((x) => x.due)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.item.name.localeCompare(b.item.name)))
    .slice(0, limit)
    .map((x) => ({ ...x, days: D(x.due) - D(today), amount: billAmount(x.item) }));
}

// Cash needed in [today, today + days] inclusive: count of payments and total dollars.
export function cashNeeded(items, today, days) {
  const end = I(D(today) + days);
  let payments = 0; let total = 0;
  for (const it of activeItems(items)) {
    const n = paymentDates(it, today, end).length;
    payments += n; total += n * billAmount(it);
  }
  return { payments, total };
}

// 12 rolling month-long windows starting today.
export function forecast12(items, today) {
  const t = D(today);
  const out = [];
  for (let n = 0; n < 12; n++) {
    const start = addMonthsDay(t, n); const end = addMonthsDay(t, n + 1) - 1;
    let total = 0;
    for (const it of activeItems(items)) {
      if (it.paymentDate) total += paymentDates(it, I(start), I(end)).length * billAmount(it);
      else total += periodAmount(it, 'Month');
    }
    out.push({ start: I(start), end: I(end), total });
  }
  return { windows: out, total: out.reduce((s, w) => s + w.total, 0) };
}

/* ---------- sinking fund ---------- */
export const isLumpSum = (it, lumpDays) => it.every * APPROX_DAYS[it.period] >= lumpDays;
export function shouldHaveSaved(item, today) {
  const due = nextDue(item, today);
  if (!due) return null;
  const bill = billAmount(item);
  const setAside = periodAmount(item, 'Fortnight');
  return Math.min(bill, Math.max(0, bill - (setAside * (D(due) - D(today))) / 14));
}
export function sinkingFund(items, today, lumpDays, limit = 8) {
  const lump = activeItems(items).filter((it) => isLumpSum(it, lumpDays));
  const rows = lump.map((item) => {
    const due = nextDue(item, today);
    return { item, due, days: due ? D(due) - D(today) : null, bill: billAmount(item), setAside: periodAmount(item, 'Fortnight'), shouldHave: shouldHaveSaved(item, today) };
  });
  return {
    setAsidePerFortnight: rows.reduce((s, r) => s + r.setAside, 0),
    shouldHaveSavedTotal: rows.reduce((s, r) => s + (r.shouldHave || 0), 0),
    next: rows.filter((r) => r.due).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, limit),
    count: rows.length,
  };
}

/* ---------- price changes ---------- */
export function priceChangeInfo(change, items) {
  const item = items.find((x) => x.id === change.itemId) || null;
  const diff = change.newCost - change.oldCost;
  const impact = item ? diff * (yearlyOf(item) / item.cost) : 0;
  return { change, item, diff, pct: diff / change.oldCost, yearlyImpact: impact };
}
export function priceRises(changes, items, today, lookbackDays) {
  const from = D(today) - lookbackDays;
  const rises = changes.filter((c) => c.newCost > c.oldCost && D(c.date) >= from && D(c.date) <= D(today))
    .map((c) => priceChangeInfo(c, items)).filter((r) => r.item);
  return {
    itemIds: new Set(rises.map((r) => r.item.id)),
    count: new Set(rises.map((r) => r.item.id)).size,
    yearlyImpact: rises.reduce((s, r) => s + r.yearlyImpact, 0),
  };
}
