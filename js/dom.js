// Tiny DOM helpers + display formatting. Strings passed to h() become text nodes, never HTML.
const moneyFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
export const formatMoney = (n) => moneyFmt.format(n);
export const formatPct = (n) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`);

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'open', 'hidden']);
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  children.flat(Infinity).forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}
export const $ = (sel) => document.querySelector(sel);
export function svgEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
export function download(filename, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
