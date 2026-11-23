// Plate relay: reads your own Garmin data with your Garmin Personal API key and hands
// only daily calories and weigh-ins to the Plate app. Garmin doesn't accept calls from
// web pages, so the app talks to this Worker instead. Deploy it to Cloudflare Workers
// (free plan) with the steps in Plate's README.
//
// Secrets (set with `npx wrangler secret put NAME`, never written in a file):
//   GARMIN_API_KEY   your Garmin Personal API key
//   RELAY_PASSCODE   a long random passcode; the same one goes into Plate's settings
// Variable (in wrangler.toml):
//   ALLOWED_ORIGINS  comma-separated sites allowed to call the relay
//
// Endpoints (all GET, all need "Authorization: Bearer <passcode>"):
//   /ping                              checks the passcode
//   /burn?start=YYYY-MM-DD&end=...     daily active, resting and total calories (max 31 days)
//   /weights?start=...&end=...         weigh-ins recorded in Garmin Connect (max 92 days)
//   /raw?kind=daily|weight&start&end   Garmin's own answer, for troubleshooting (max 3 days)

const GARMIN = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UA = 'plate-relay/1.0';

let cachedToken = null; // { token, key, exp }, kept while this Worker instance stays warm

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = okOrigin
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (request.method !== 'GET') return reply({ error: 'method' }, 405);
    if (!env.GARMIN_API_KEY || !env.RELAY_PASSCODE) {
      return reply({ error: 'setup', message: 'The relay is missing GARMIN_API_KEY or RELAY_PASSCODE.' }, 500);
    }
    // Spaces around the passphrase are ignored (pasting often adds one). On a mismatch,
    // only the lengths are logged, never the values, so `wrangler tail` can show why.
    const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const want = String(env.RELAY_PASSCODE).trim();
    if (!(await same(got, want))) {
      console.log(`passcode mismatch: received ${got.length} characters, expected ${want.length}`);
      return reply({ error: 'passcode' }, 401);
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (route === '/ping') return reply({ ok: true });
      if (route === '/burn') {
        const [start, end] = dates(url, 31);
        const data = await garmin(env, `/usersummary-service/v2/dailysummaries?startDate=${start}&endDate=${end}`);
        const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        const days = list
          .map(d => ({ date: d?.calendarDate, active: d?.calories?.burnedActive, resting: d?.calories?.burnedResting, total: d?.calories?.burnedTotal }))
          .filter(d => DAY.test(d.date || '') && Number.isFinite(d.active) && Number.isFinite(d.total));
        return reply({ days, fetchedAt: Date.now() });
      }
      if (route === '/weights') {
        const [start, end] = dates(url, 92);
        return reply({ weights: findWeights(await garmin(env, `/weight-service/weight/range/${start}/${end}`)) });
      }
      if (route === '/raw') {
        const [start, end] = dates(url, 3);
        const path = url.searchParams.get('kind') === 'weight'
          ? `/weight-service/weight/range/${start}/${end}`
          : `/usersummary-service/v2/dailysummaries?startDate=${start}&endDate=${end}`;
        return reply(await garmin(env, path));
      }
      return reply({ error: 'not_found' }, 404);
    } catch (e) {
      return reply({ error: e.code || 'garmin_down', message: String(e.message || e).slice(0, 300) }, e.status || 502);
    }
  },
};

function fail(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

function dates(url, maxDays) {
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || start;
  if (!DAY.test(start) || !DAY.test(end) || start > end) throw fail('start and end must be YYYY-MM-DD, start first.', 'bad_request', 400);
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  if (days > maxDays) throw fail(`Ask for at most ${maxDays} days at a time.`, 'bad_request', 400);
  return [start, end];
}

async function getToken(env) {
  if (cachedToken && cachedToken.key === env.GARMIN_API_KEY && cachedToken.exp - Date.now() > 3600e3) return cachedToken.token;
  const res = await fetch(GARMIN + TOKEN_PATH, {
    method: 'POST',
    headers: { Accept: '*/*', Authorization: `ApiKey ${env.GARMIN_API_KEY}`, 'User-Agent': UA },
  });
  if (!res.ok) {
    const bad = res.status === 401 || res.status === 403;
    throw fail(bad ? 'Garmin rejected the Personal API key. It may have expired.' : `Garmin answered ${res.status} when asked for a token.`, bad ? 'garmin_key' : 'garmin_down', 502);
  }
  const token = (await res.text()).trim();
  cachedToken = { token, key: env.GARMIN_API_KEY, exp: jwtExp(token) || Date.now() + 23 * 3600e3 };
  return token;
}

async function garmin(env, path, retried = false) {
  const token = await getToken(env);
  const res = await fetch(GARMIN + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 401 && !retried) {
    cachedToken = null; // the token may have been revoked; get a fresh one once
    return garmin(env, path, true);
  }
  if (!res.ok) throw fail(`Garmin answered ${res.status}.`, res.status === 401 || res.status === 403 ? 'garmin_key' : 'garmin_down', 502);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function jwtExp(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
    return claims.exp ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// Garmin's weight data nests the readings; take any object with a date and a weight.
// Weights above 1,000 are grams.
function findWeights(data) {
  const out = new Map();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const date = v.calendarDate || v.summaryDate;
    const w = Number(v.weight);
    if (DAY.test(date || '') && Number.isFinite(w) && w > 0) out.set(date, Math.round((w > 1000 ? w / 1000 : w) * 10) / 10);
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x, depth + 1);
  };
  walk(data, 0);
  return [...out].map(([date, kg]) => ({ date, kg })).sort((a, b) => a.date.localeCompare(b.date));
}

// Compare hashes so the time taken doesn't leak how much of the passcode matched.
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}
