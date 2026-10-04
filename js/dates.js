// Date-only arithmetic. Dates are 'YYYY-MM-DD' strings outside; internally whole days since 1970-01-01 (UTC math on
// calendar components only, so there are no timezone or DST off-by-one problems).
const MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
  return t / MS;
}
export function ymd(day) {
  const dt = new Date(day * MS);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}
export function toISO(day) {
  const [y, m, d] = ymd(day);
  return `${y}-${pad(m)}-${pad(d)}`;
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

// Add n months to a day number, clamping to the end of the target month (31 Jan + 1 month = 28/29 Feb).
export function addMonthsDay(day, n) {
  const [y, m, d] = ymd(day);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return Date.UTC(ny, nm - 1, Math.min(d, daysInMonth(ny, nm))) / MS;
}
export const addMonths = (iso, n) => toISO(addMonthsDay(parseISO(iso), n));
export const addDays = (iso, n) => toISO(parseISO(iso) + n);
export const daysBetween = (aISO, bISO) => parseISO(bISO) - parseISO(aISO);
export function monthsBetweenDays(a, b) {
  const [ay, am] = ymd(a); const [by, bm] = ymd(b);
  return (by * 12 + bm) - (ay * 12 + am);
}

// The local calendar date (not UTC).
export function localToday() {
  const n = new Date();
  return toISO(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / MS);
}

// "Sun 4 Oct" (adds the year when it differs from refISO's year).
export function formatDate(iso, refISO) {
  const day = parseISO(iso);
  if (Number.isNaN(day)) return '';
  const [y, m, d] = ymd(day);
  const wd = WEEKDAYS[(((day + 4) % 7) + 7) % 7]; // 1970-01-01 was a Thursday
  const yr = refISO && ymd(parseISO(refISO))[0] !== y ? ' ' + y : '';
  return `${wd} ${d} ${MONTHS[m - 1]}${yr}`;
}
export function formatShort(iso) { // "4 Oct"
  const [, m, d] = ymd(parseISO(iso));
  return `${d} ${MONTHS[m - 1]}`;
}

// Accepts YYYY-MM-DD, D/M/YYYY (Australian order) and D MMM[M] YYYY. Returns ISO or null.
export function parseFlexibleDate(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  let y, m, d;
  let r;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t))) {
    const idx = MONTHS.findIndex((x) => r[2].toLowerCase().startsWith(x.toLowerCase()));
    if (idx < 0) return null;
    [d, m, y] = [+r[1], idx + 1, +r[3]];
  } else return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return Number.isNaN(parseISO(iso)) ? null : iso;
}
