// Draws Plate's icon (an indigo tile with a three-quarter progress ring) as PNGs and an SVG.
// No dependencies: shapes are sampled 4x4 per pixel and written with node:zlib.
// Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(out, { recursive: true });

const C1 = [108, 99, 255];  // #6C63FF top left
const C2 = [67, 56, 202];   // #4338CA bottom right
const RING_R = 0.285;
const RING_W = 0.085;
const ARC = 0.75 * 2 * Math.PI;
const CORNER = 0.2237;      // iOS-like corner radius for the rounded versions

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function insideRounded(x, y, r) {
  if ((x >= r && x <= 1 - r) || (y >= r && y <= 1 - r)) return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  const cx = x < r ? r : 1 - r;
  const cy = y < r ? r : 1 - r;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Colour of one sample point: [r, g, b, a] in 0..1 (rgb 0..255).
function sample(x, y, rounded) {
  if (rounded && !insideRounded(x, y, CORNER)) return [0, 0, 0, 0];
  const t = Math.min(1, Math.max(0, (x + y) / 2));
  let c = C1.map((v, i) => v + (C2[i] - v) * t);
  const dx = x - 0.5;
  const dy = y - 0.5;
  const d = Math.hypot(dx, dy);
  const onRing = Math.abs(d - RING_R) <= RING_W / 2;
  const mix = (a) => { c = c.map(v => v + (255 - v) * a); };
  if (onRing) mix(0.3);
  const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI); // 0 at the top, clockwise
  const capAt = a => [0.5 + RING_R * Math.sin(a), 0.5 - RING_R * Math.cos(a)];
  const nearCap = a => { const [px, py] = capAt(a); return Math.hypot(x - px, y - py) <= RING_W / 2; };
  if ((onRing && angle <= ARC) || nearCap(0) || nearCap(ARC)) c = [255, 255, 255];
  return [...c, 1];
}

function render(size, rounded) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb, ca] = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, rounded);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (py * size + px) * 4;
      const n = SS * SS;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, buf);
}

writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, false)); // iOS rounds the corners itself
writeFileSync(path.join(out, 'icon-192.png'), render(192, true));
writeFileSync(path.join(out, 'icon-512.png'), render(512, true));
writeFileSync(path.join(out, 'icon-maskable-512.png'), render(512, false)); // ring sits inside the 80% safe zone

const r = RING_R * 100;
const w = RING_W * 100;
writeFileSync(path.join(out, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6C63FF"/><stop offset="1" stop-color="#4338CA"/></linearGradient></defs>
  <rect width="100" height="100" rx="${CORNER * 100}" fill="url(#g)"/>
  <circle cx="50" cy="50" r="${r}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="${w}"/>
  <path d="M50 ${50 - r} A${r} ${r} 0 1 1 ${50 - r} 50" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round"/>
</svg>
`);
console.log('Icons written to', out);
