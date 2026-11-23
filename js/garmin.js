// Garmin: daily calories burned (and weigh-ins) from the user's own relay, a small
// Cloudflare Worker that holds their Garmin Personal API key. Garmin doesn't accept
// calls from web pages, so the app can't call it directly.
import { state, save, getRelay } from './store.js';
import { dayKey, addDays, isDayKey, timeoutSignal, sleep } from './util.js';
import { MOCK } from './ai.js';

export class GarminError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const garminConnected = () => MOCK || !!getRelay()?.url;

const MESSAGES = {
  passcode: 'The relay passcode doesn\'t match. Check it in Settings → Garmin.',
  garmin_key: 'Garmin rejected your key. It may have expired: create a new one and update the relay.',
  garmin_down: 'Garmin isn\'t answering right now. Try again later.',
  setup: 'The relay is missing its Garmin key or passcode. See the README.',
};

export async function relayFetch(path, params = {}, cfg = getRelay()) {
  if (!cfg?.url || !cfg?.pass) throw new GarminError('setup', 'Connect Garmin in Settings first.');
  let url;
  try {
    url = new URL(path, cfg.url.trim().replace(/\/*$/, '/'));
  } catch {
    throw new GarminError('url', 'That relay address doesn\'t look right. It should start with https://');
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.pass}` }, cache: 'no-store', signal: timeoutSignal(25000) });
  } catch {
    throw new GarminError('network', navigator.onLine === false ? 'You\'re offline.' : 'Couldn\'t reach your Garmin relay. Check its address.');
  }
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new GarminError(body.error || String(res.status), MESSAGES[body.error] || body.message || `The relay answered ${res.status}.`);
  return body;
}

// Keep one weigh-in per day per source; a weight typed into Plate wins over Garmin's.
export function mergeWeights(list, source) {
  for (const w of list) {
    const kg = Math.round(Number(w.kg) * 10) / 10;
    if (!isDayKey(w.date) || !(kg > 20 && kg < 400)) continue;
    const same = state.weights.find(x => x.date === w.date && x.source === source);
    const manual = state.weights.find(x => x.date === w.date && x.source === 'manual');
    if (manual) continue;
    if (same) same.kg = kg;
    else state.weights.push({ date: w.date, kg, source });
  }
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
}

let inflight = null;

// Fetch recent days (28 the first time, so the typical day is known straight away).
// Throttled to once every 5 minutes unless forced. Returns true when data changed.
export function syncGarmin({ force = false } = {}) {
  if (!garminConnected()) return Promise.resolve(false);
  if (inflight) return inflight;
  const g = state.garmin;
  if (!force && Date.now() - g.lastSync < 5 * 60000) return Promise.resolve(false);
  inflight = (MOCK ? mockSync() : realSync())
    .then(() => { g.lastSync = Date.now(); g.lastError = ''; g.firstSyncDone = true; save(); return true; })
    .catch(e => { g.lastError = e.message; save(); throw e; })
    .finally(() => { inflight = null; });
  return inflight;
}

async function realSync() {
  const g = state.garmin;
  const end = dayKey();
  const start = addDays(end, g.firstSyncDone ? -2 : -27);
  const body = await relayFetch('burn', { start, end });
  for (const d of body.days || []) {
    const active = Number(d.active);
    const total = Number(d.total);
    if (!isDayKey(d.date) || !Number.isFinite(active) || !Number.isFinite(total)) continue;
    state.burn[d.date] = { active: Math.round(active), resting: Math.round(Number(d.resting) || 0), total: Math.round(total), at: Date.now() };
  }
  if (Date.now() - g.lastWeightSync > 6 * 3600e3) {
    try {
      const w = await relayFetch('weights', { start: addDays(end, g.lastWeightSync ? -13 : -89), end });
      mergeWeights(w.weights || [], 'garmin');
      g.lastWeightSync = Date.now();
    } catch {
      // Weigh-ins are a bonus; calories still count as synced.
    }
  }
}

async function mockSync() {
  await sleep(500);
  const end = dayKey();
  for (let i = 0; i < 28; i++) {
    const key = addDays(end, -i);
    if (state.burn[key] && i > 1) continue;
    const active = i === 0 ? 420 : 230 + ((i * 97) % 260);
    state.burn[key] = { active, resting: 1645, total: 1645 + active, at: Date.now() };
  }
}

export async function testRelay(cfg) {
  if (MOCK) { await sleep(400); return true; }
  await relayFetch('ping', {}, cfg);
  const end = dayKey();
  await relayFetch('burn', { start: end, end }, cfg);
  return true;
}
