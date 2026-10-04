// Calendar export: one all-day VEVENT per payment over the next 12 months, each with a VALARM `alertDays` before.
import { activeItems, billAmount, paymentDates } from './calc.js';
import { addMonths, parseISO, toISO } from './dates.js';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (iso) => iso.replace(/-/g, '');
function fold(line) { // RFC 5545: lines max 75 chars, continuation lines start with a space
  const parts = [];
  while (line.length > 75) { parts.push(line.slice(0, 75)); line = ' ' + line.slice(75); }
  parts.push(line);
  return parts;
}

export function collectPayments(items, today) {
  const end = addMonths(today, 12);
  const events = [];
  for (const item of activeItems(items)) {
    for (const date of paymentDates(item, today, end)) events.push({ item, date });
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function buildICS(items, today, alertDays, stamp = '20260101T000000Z') {
  const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Budget Tracker//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Budget payments'];
  collectPayments(items, today).forEach(({ item, date }, i) => {
    const title = `${item.name} – ${money.format(billAmount(item))}`;
    lines.push('BEGIN:VEVENT', `UID:${item.id}-${compact(date)}-${i}@budget-tracker`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(toISO(parseISO(date) + 1))}`,
      `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(item.notes || 'Payment due')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title + ' is due')}`, `TRIGGER:-P${alertDays}D`, 'END:VALARM', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.flatMap(fold).join('\r\n') + '\r\n';
}
