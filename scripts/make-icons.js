// Draws the app icons (PNG, no dependencies). Run: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// DevDan Startup palette: near-black bg, aurora glow, accent/teal bars.
const BG = [7, 7, 11], TEAL = [64, 200, 224], WHITE = [245, 245, 247], BLUE = [100, 181, 255];
const glow = (u, v, cx, cy, r) => Math.pow(Math.max(0, 1 - Math.hypot(u - cx, v - cy) / r), 2);

// Signed distance to a rounded rect centred (cx,cy) with half-sizes (hw,hh) and radius r.
function sdRound(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r), dy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

// scale<1 shrinks the glyph (for maskable safe zone); rounded=false gives a full-bleed square.
function draw(size, { scale, rounded }) {
  const S = 3; // supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + .5) / S) / size, v = (y + (sy + .5) / S) / size; // 0..1
      let col = null;
      if (!rounded || sdRound(u, v, .5, .5, .5, .5, .22) < 0) {
        const a1 = glow(u, v, .15, .1, .8) * .75, a2 = glow(u, v, .95, .95, .7) * .65;
        col = [0, 1, 2].map((k) => Math.min(255, BG[k] + [94, 92, 230][k] * a1 + [10, 132, 255][k] * a2));
      }
      if (col) {
        // three rising bars, centred
        const bars = [[-.2, .14, TEAL], [0, .24, WHITE], [.2, .36, BLUE]];
        for (const [ox, h, c] of bars) {
          const cx = .5 + ox * scale, bw = .075 * scale, bh = h * scale;
          const cy = .5 + .18 * scale - bh;
          if (sdRound(u, v, cx, cy, bw, bh, .05 * scale) < 0) col = c;
        }
        r += col[0]; g += col[1]; b += col[2]; a += 255;
      }
    }
    const n = S * S, i = (y * size + x) * 4;
    px[i] = a ? r / (a / 255) : 0; px[i + 1] = a ? g / (a / 255) : 0; px[i + 2] = a ? b / (a / 255) : 0; px[i + 3] = a / n;
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), draw(192, { scale: 1, rounded: true }));
fs.writeFileSync(path.join(out, 'icon-512.png'), draw(512, { scale: 1, rounded: true }));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), draw(512, { scale: .72, rounded: false }));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), draw(180, { scale: .9, rounded: false })); // iOS rounds it itself
fs.writeFileSync(path.join(out, 'icon.svg'),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="a" cx=".15" cy=".1" r=".8"><stop offset="0" stop-color="#5e5ce6" stop-opacity=".75"/><stop offset="1" stop-color="#5e5ce6" stop-opacity="0"/></radialGradient><radialGradient id="b" cx=".95" cy=".95" r=".7"><stop offset="0" stop-color="#0a84ff" stop-opacity=".65"/><stop offset="1" stop-color="#0a84ff" stop-opacity="0"/></radialGradient></defs><rect width="100" height="100" rx="22" fill="#07070b"/><rect width="100" height="100" rx="22" fill="url(#a)"/><rect width="100" height="100" rx="22" fill="url(#b)"/>
<rect x="27" y="53" width="15" height="14" rx="5" fill="#40c8e0"/><rect x="42.5" y="43" width="15" height="24" rx="5" fill="#f5f5f7"/><rect x="58" y="31" width="15" height="36" rx="5" fill="#64b5ff"/></svg>
`);
console.log('icons written');
