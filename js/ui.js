// Shared UI pieces: icons, bottom sheets, toasts, confirm dialogs, rings and macro lines.
import { esc, num, clamp } from './util.js';

// ---------- icons (24x24, stroked) ----------

const ICONS = {
  today: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>',
  trends: '<path d="M5 19.5V13M10 19.5V8M15 19.5v-5M20 19.5V5"/>',
  body: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 10a5 5 0 0 1 7 0M12 10l1.6-2.2"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  camera: '<path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20V19H4z"/><circle cx="12" cy="13.3" r="3.4"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9.2" cy="10" r="1.6"/><path d="M5 17.5l4.6-4.6 3.1 3.1 2.6-2.6 3.7 3.7"/>',
  send: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
  flame: '<path d="M12 21c-3.5 0-6-2.4-6-5.6 0-3.3 2.5-5 3.7-7.6.4 1.7 1.3 2.7 2.4 3.2.2-3.1 1.4-5.5 3.3-7.2-.2 3.2 2.6 5.4 2.6 9.6 0 4.3-2.6 7.6-6 7.6z"/>',
  sparkle: '<path d="M11 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/><path d="M18 15l.8 2.1 2.2.9-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.9z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  watch: '<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5L9.7 3h4.6l.7 3.5M9 17.5l.7 3.5h4.6l.7-3.5M12 9.5V12l1.5 1"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L19 4M16 7l2.5 2.5M13.8 9.2l2 2"/>',
  alert: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.2M12 17v.1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.6 2.6 5-5.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  back: '<path d="M14.5 6l-6 6 6 6"/>',
  share: '<path d="M12 4v11M8 8l4-4 4 4M5 13v6.5h14V13"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 12.5h9.4L17.5 7M9.5 7V4.5h5V7"/>',
  edit: '<path d="M4 20h4.5L19 9.5 14.5 5 4 15.5z"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4M5 19.5h14"/>',
  upload: '<path d="M12 15V4M8 8l4-4 4 4M5 19.5h14"/>',
  paste: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5h5v2.5h-5z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  link: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v5.5H4.5V7H10"/>',
};

export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- rendering hooks ----------

let renderer = () => {};
export const setRenderer = fn => { renderer = fn; };
export const rerender = () => renderer();
export function go(hash) {
  if (location.hash === hash) renderer();
  else location.hash = hash;
}

// ---------- toast ----------

let toastTimer;
let toastAction = null;

export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toast-action">${esc(action)}</button>` : ''}`;
  el.classList.add('show');
  toastAction = onAction || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? Math.max(ms, 6000) : ms);
}

export function runToastAction() {
  document.getElementById('toast').classList.remove('show');
  const f = toastAction;
  toastAction = null;
  f?.();
}

// ---------- bottom sheet ----------

let onSheetClose = null;
let pendingConfirm = null;
let hideTimer;
let currentTag = null;

export function openSheet(html, { onClose, cls = '', tag = null } = {}) {
  const root = document.getElementById('sheet');
  clearTimeout(hideTimer); // a sheet that was closing must not take this one with it
  const prev = onSheetClose;
  onSheetClose = null;
  prev?.(); // the sheet being replaced still gets its close callback
  root.classList.remove('open');
  root.innerHTML = `<div class="sheet-backdrop" data-act="sheet-close"></div>
    <div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="sheet-grab"></div><div class="sheet-body">${html}</div></div>`;
  root.hidden = false;
  void root.offsetWidth; // apply the closed position first so the slide-in transition runs
  root.classList.add('open');
  onSheetClose = onClose || null;
  currentTag = tag;
}

// Replace the open sheet's content in place (no slide), keeping its scroll position.
export function setSheet(html) {
  const sheet = document.querySelector('#sheet .sheet');
  const body = sheet?.querySelector('.sheet-body');
  if (!body) return false;
  const y = sheet.scrollTop;
  body.innerHTML = html;
  sheet.scrollTop = y;
  return true;
}

export const sheetTag = () => (document.getElementById('sheet')?.hidden ? null : currentTag);

export function closeSheet() {
  const root = document.getElementById('sheet');
  if (root.hidden) return;
  root.classList.remove('open');
  document.activeElement?.blur?.();
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { root.hidden = true; root.innerHTML = ''; }, 220);
  currentTag = null;
  const cb = onSheetClose;
  onSheetClose = null;
  cb?.();
}

export function confirmSheet({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    pendingConfirm = v => { answered = true; resolve(v); };
    openSheet(`<h3 class="sheet-title">${esc(title)}</h3>${body ? `<p class="muted">${esc(body)}</p>` : ''}
      <div class="sheet-actions">
        <button class="btn ${danger ? 'danger' : 'primary'}" data-act="confirm-yes">${esc(ok)}</button>
        <button class="btn ghost" data-act="sheet-close">${esc(cancel)}</button>
      </div>`, { onClose: () => { if (!answered) resolve(false); } });
  });
}

export function answerConfirm() {
  const f = pendingConfirm;
  pendingConfirm = null;
  f?.(true);
  closeSheet();
}

// Keep sheets above the iPhone keyboard: --kb is how much of the screen it covers.
const vv = typeof window !== 'undefined' ? window.visualViewport : null;
if (vv) {
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
    document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

// ---------- small renderers ----------

// A progress ring. The track is a light step of the same colour; tone sets the colour.
export function ring(fraction, tone = '', size = 54, stroke = 6) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = clamp(Number(fraction) || 0, 0, 1);
  const mid = size / 2;
  return `<svg class="ring ${tone ? `tone-${tone}` : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>
    ${p > 0 ? `<circle class="ring-fill" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>` : ''}
  </svg>`;
}

// Chart tooltips: hover a .hit rect with a mouse, or tap it on a phone. A second tap
// (or Enter) on the same mark calls onOpen with its data-key.
export function bindTips(svg, { text, onOpen } = {}) {
  const wrap = svg?.closest('.chart-wrap');
  const tip = wrap?.querySelector('.chart-tip');
  if (!wrap || !tip) return;
  let current = null;
  const marks = () => svg.querySelectorAll('.hit');
  const show = rect => {
    const t = text(rect.dataset.key);
    if (!t) return;
    tip.textContent = t;
    tip.hidden = false;
    const box = rect.getBoundingClientRect();
    const outer = wrap.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(outer.width - w, box.left - outer.left + box.width / 2 - w / 2))}px`;
    for (const h of marks()) h.classList.toggle('active', h === rect);
    current = rect.dataset.key;
  };
  const hide = () => {
    tip.hidden = true;
    for (const h of marks()) h.classList.remove('active');
    current = null;
  };
  svg.addEventListener('pointerover', e => { if (e.pointerType === 'mouse' && e.target.matches?.('.hit')) show(e.target); });
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('click', e => {
    const rect = e.target.closest?.('.hit');
    if (!rect) return;
    if (current === rect.dataset.key && onOpen) onOpen(rect.dataset.key);
    else show(rect);
  });
  svg.addEventListener('focusin', e => { if (e.target.matches?.('.hit')) show(e.target); });
  svg.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('.hit') && onOpen) onOpen(e.target.dataset.key); });
}

// "P 22 · C 38 · F 8" in text ink (never the data colour).
export const macroLine = t => `<span class="macros">P <b>${num(t.protein)}</b> · C <b>${num(t.carbs)}</b> · F <b>${num(t.fat)}</b></span>`;

export function standalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export async function copyText(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
    return true;
  } catch {
    toast('Couldn\'t copy from this browser.');
    return false;
  }
}

export async function shareText(text, title = 'Plate') {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return; }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  await copyText(text, 'Copied. Paste it wherever you like.');
}
