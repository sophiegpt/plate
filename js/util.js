// Small helpers shared by every screen: escaping, numbers, dates and meals.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, step = 1) => Math.round((Number(v) || 0) / step) * step;
export const num = v => Math.round(Number(v) || 0).toLocaleString();
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const mean = arr => (arr.length ? sum(arr) / arr.length : 0);
export const clone = o => JSON.parse(JSON.stringify(o));
export const plural = (n, word, many = `${word}s`) => `${num(n)} ${Math.round(n) === 1 ? word : many}`;

// ---------- dates: local time, 'YYYY-MM-DD' keys ----------

const pad = n => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const isDayKey = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);

export function dayTitle(key) {
  const today = dayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  return parseDay(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export const dayLong = key => parseDay(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
export const dayShort = key => parseDay(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const weekdayShort = key => parseDay(key).toLocaleDateString(undefined, { weekday: 'short' });
export const timeText = ts => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function ago(ts) {
  if (!ts) return 'never';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return dayShort(dayKey(new Date(ts)));
}

// A timestamp on `key` at the current clock time (used when logging onto a past day).
export function stampFor(key) {
  if (key === dayKey()) return Date.now();
  const d = parseDay(key);
  const now = new Date();
  d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return d.getTime();
}

// ---------- meals ----------

export const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
export const MEAL_KEYS = MEALS.map(m => m[0]);
export const mealLabel = k => (MEALS.find(m => m[0] === k) || MEALS[3])[1];

export function mealFor(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

export function timeoutSignal(ms) {
  if (AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// Random URL-safe passcode for the Garmin relay.
export function randomPasscode(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
