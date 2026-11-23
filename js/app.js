// Boot, hash router and event delegation. Views live in ./views; each exports routes,
// actions and binds.
import { state, load, save, requestPersistence, isMemoryOnly } from './store.js';
import { icon, setRenderer, closeSheet, answerConfirm, runToastAction, toast } from './ui.js';
import { dayKey } from './util.js';
import { pruneThumbs } from './photos.js';
import { garminConnected, syncGarmin } from './garmin.js';
import * as today from './views/today.js';
import * as log from './views/log.js';
import * as trends from './views/trends.js';
import * as body from './views/body.js';
import * as settings from './views/settings.js';
import * as welcome from './views/welcome.js';

const modules = [today, log, trends, body, settings, welcome];
const ROUTES = Object.assign({}, ...modules.map(m => m.routes || {}));
const ACTIONS = Object.assign({}, ...modules.map(m => m.actions || {}));
const BINDS = Object.assign({}, ...modules.map(m => m.binds || {}));

const TABS = [['today', '#/', 'Today'], ['trends', '#/trends', 'Trends'], ['body', '#/body', 'Body'], ['settings', '#/settings', 'Settings']];

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
tabbar.innerHTML = TABS.map(([k, href, label]) => `<a href="${href}" data-tab="${k}">${icon(k)}<span>${label}</span></a>`).join('');

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { name: parts[0] || 'today', param: parts.slice(1).join('/') };
}

let current = null;
let currentKey = '';
let renderedDay = dayKey();

function render() {
  let { name, param } = parseRoute();
  if (!state.onboarded && !['welcome', 'about', 'settings'].includes(name)) {
    history.replaceState(null, '', '#/welcome');
    name = 'welcome';
    param = '';
  }
  const route = ROUTES[name] || ROUTES.today;
  const key = `${name}/${param}`;
  const same = key === currentKey;
  const y = same ? window.scrollY : 0;
  if (current && (current !== route || !same)) current.unmount?.();
  app.innerHTML = route.html(param);
  document.body.classList.toggle('no-tabs', route.tabs === false);
  document.body.classList.toggle('has-composer', !!route.composer);
  for (const a of tabbar.querySelectorAll('a')) {
    const on = a.dataset.tab === route.tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  route.mount?.(param);
  window.scrollTo(0, y);
  current = route;
  currentKey = key;
  renderedDay = dayKey();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'sheet-close') { closeSheet(); return; }
  if (act === 'confirm-yes') { answerConfirm(); return; }
  if (act === 'toast-action') { runToastAction(); return; }
  const fn = ACTIONS[act];
  if (!fn) return;
  if (el.tagName === 'BUTTON' || el.tagName === 'A') e.preventDefault();
  fn(el, e);
});

const isToggle = el => el.type === 'checkbox' || el.type === 'file' || el.tagName === 'SELECT';

document.addEventListener('input', e => {
  const el = e.target.closest?.('[data-bind]');
  if (!el || isToggle(el)) return;
  BINDS[el.dataset.bind]?.(el, e);
});

document.addEventListener('change', e => {
  const el = e.target.closest?.('[data-bind]');
  if (!el || !isToggle(el)) return;
  if (el.dataset.bind === 'setting') {
    state.settings[el.dataset.key] = el.checked;
    save();
    return;
  }
  BINDS[el.dataset.bind]?.(el, e);
});

// Enter in a field with data-enter runs that action (the keyboard's Go/Send key).
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSheet(); return; }
  const act = e.target?.dataset?.enter;
  if (e.key === 'Enter' && act && ACTIONS[act] && !e.isComposing) {
    e.preventDefault();
    ACTIONS[act](e.target, e);
  }
});

// Number inputs: select the contents on focus so a new value can be typed straight away.
document.addEventListener('focusin', e => {
  if (e.target.matches?.('input[type="number"]')) setTimeout(() => e.target.select?.(), 0);
});

// Coming back to the app: a new day starts on the right page, and Garmin catches up.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const { name } = parseRoute();
  if (dayKey() !== renderedDay && (name === 'today' || name === '')) render();
  if (garminConnected() && (name === 'today' || name === '')) {
    syncGarmin().then(changed => { if (changed) render(); }).catch(() => {});
  }
});

// ---------- offline support ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !location.search.includes('sw')) return; // keep local testing cache-free
  let accepted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (accepted) location.reload(); });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offer = worker => toast('A new version of Plate is ready.', {
      action: 'Update', ms: 20000,
      onAction: () => { accepted = true; worker.postMessage('skip-waiting'); },
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

// ---------- boot ----------

load();
setRenderer(render);
window.addEventListener('hashchange', render);
window.addEventListener('pageshow', e => { if (e.persisted) render(); });
// iOS grants persistent storage to installed apps; asking from a tap is the most reliable.
document.addEventListener('click', () => requestPersistence(), { once: true });
render();
registerServiceWorker();
if (isMemoryOnly()) toast('This browser is blocking storage, so nothing will be saved.', { ms: 6000 });

// Tidy up thumbnails of deleted entries once things are quiet.
setTimeout(() => {
  const keep = new Set();
  for (const d of Object.values(state.days)) for (const e of d.entries || []) if (e.photoId) keep.add(e.photoId);
  for (const f of state.favorites) if (f.photoId) keep.add(f.photoId);
  pruneThumbs(keep);
}, 4000);
