// Everything Plate remembers lives in one object, saved to localStorage on this phone.
// The Anthropic key and the Garmin relay details live under their own keys, so they
// never end up in a backup file.

const KEY = 'plate:v1';
const KEY_API = 'plate:anthropic-key';
const KEY_RELAY = 'plate:garmin-relay';
export const APP_VERSION = '1.0.1';

const defaults = () => ({
  version: 1,
  onboarded: false,
  settings: {
    quickModel: 'claude-haiku-5-5', // typed entries
    mainModel: 'claude-sonnet-5-5', // photos, body scans and the daily recap
    effort: 'medium',     // low | medium | high
    tone: 'tough',        // straight | gentle | tough
    swaps: 'auto',        // auto | always | ask
    webLookup: true,
    notes: '',            // the user's food preferences and allergies
    flex: true,           // adjust the day's target for Garmin activity
  },
  profile: { goal: 'recomp', activity: 1.55, sex: '', age: null, heightCm: null },
  targets: null,          // { kcal, protein, carbs, fat, basis, source, setAt }
  days: {},               // 'YYYY-MM-DD' -> { entries: [], recap: null }
  favorites: [],          // { id, title, items }
  weights: [],            // { date, kg, source: 'manual' | 'scan' | 'garmin' }
  scans: [],              // body-composition scans, newest last
  burn: {},               // 'YYYY-MM-DD' -> { active, resting, total, at } from Garmin
  garmin: { lastSync: 0, lastError: '', firstSyncDone: false, lastWeightSync: 0 },
  usage: {},              // 'YYYY-MM' -> { usd, calls }
  compat: { safe: false },// set if the API rejected optional request features
  tipsSeen: {},
});

export let state = defaults();
let memoryOnly = false;

function migrate(s) {
  const d = defaults();
  return {
    ...d, ...s,
    settings: { ...d.settings, ...(s.settings || {}) },
    profile: { ...d.profile, ...(s.profile || {}) },
    garmin: { ...d.garmin, ...(s.garmin || {}) },
    compat: { ...d.compat, ...(s.compat || {}) },
    days: s.days || {},
    burn: s.burn || {},
    usage: s.usage || {},
    favorites: s.favorites || [],
    weights: s.weights || [],
    scans: s.scans || [],
    tipsSeen: s.tipsSeen || {},
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = migrate(JSON.parse(raw));
  } catch {
    memoryOnly = true;
  }
  return state;
}

let pending;
export function save(now = false) {
  clearTimeout(pending);
  const write = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); memoryOnly = false; } catch { memoryOnly = true; }
  };
  if (now) write(); else pending = setTimeout(write, 250);
}

export const isMemoryOnly = () => memoryOnly;

// The record for one day. With create, it is added to the state if missing.
export function day(key, create = false) {
  let d = state.days[key];
  if (!d && create) d = state.days[key] = { entries: [], recap: null };
  return d || { entries: [], recap: null };
}

// ---------- secrets, kept outside the main object ----------

export function getApiKey() {
  try { return localStorage.getItem(KEY_API) || ''; } catch { return ''; }
}

export function setApiKey(k) {
  try { if (k) localStorage.setItem(KEY_API, k); else localStorage.removeItem(KEY_API); } catch { /* storage blocked */ }
}

export function getRelay() {
  try { return JSON.parse(localStorage.getItem(KEY_RELAY) || 'null'); } catch { return null; }
}

export function setRelay(r) {
  try { if (r) localStorage.setItem(KEY_RELAY, JSON.stringify(r)); else localStorage.removeItem(KEY_RELAY); } catch { /* storage blocked */ }
}

// ---------- backups (never include the key, the relay passcode or photos) ----------

export function backupJSON() {
  const { compat, ...data } = state;
  return JSON.stringify({ app: 'plate', version: APP_VERSION, exportedAt: new Date().toISOString(), data });
}

export function parseBackup(text) {
  const obj = JSON.parse(text);
  const data = obj?.app === 'plate' ? obj.data : obj;
  if (!data || typeof data !== 'object' || !data.settings || typeof data.days !== 'object') {
    throw new Error('That file isn\'t a Plate backup.');
  }
  return data;
}

export function replaceState(data) {
  state = migrate(data);
  save(true);
}

export function resetState() {
  state = defaults();
  save(true);
  setApiKey('');
  setRelay(null);
}

// Ask the browser not to evict our data under storage pressure (no-op where unsupported).
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}

// iOS can drop a backgrounded web app without warning, so flush straight away when hidden.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
  window.addEventListener('pagehide', () => save(true));
}
