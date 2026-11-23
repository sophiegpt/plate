#!/usr/bin/env node
// Plate: one-off check that Garmin's Personal API returns your calories.
//
// What it does
//   1. Asks for your Garmin Personal API key. What you type or paste stays hidden.
//   2. Swaps the key for a 24-hour access token at Garmin.
//   3. Reads your Garmin daily summaries for the last three days.
//   4. Prints only calorie numbers, last-sync times and the names of the fields
//      Garmin returns. Nothing is written to disk.
//
// It talks only to https://personal.connectapi.garmin.com, using the same calls as
// Garmin's official example (github.com/garmin/connect-personal-api-python).
//
// Run it from a terminal in the plate folder:
//   node --use-system-ca tools/garmin-test.mjs
// To skip the prompt, set GARMIN_PERSONAL_API_KEY in the environment first.

import readline from 'node:readline';

const BASE = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const DAILY_PATH = '/usersummary-service/v2/dailysummaries';
const DAYS = 3;
const TIMEOUT_MS = 30000;
const USER_AGENT = 'plate-garmin-test/1.0';

const CALORIE_FIELD = /kilocal|calor|kcal|energy/i;
const SYNC_FIELD = /sync|lastupdat|updatedate|modified/i;
const DATE_FIELDS = ['calendarDate', 'date', 'summaryDate', 'startDate'];

// Anything in here is replaced with [hidden] before it reaches the screen.
const secrets = [];
const redact = text => secrets.reduce((t, s) => (s ? t.split(s).join('[hidden]') : t), String(text));
const say = (line = '') => process.stdout.write(`${redact(line)}\n`);

// Stopping by throwing (not process.exit) lets Node close its network handles first,
// which avoids a libuv assertion crash on Windows.
class Stop extends Error {}

function fail(message, detail) {
  say('');
  say(`Stopped: ${message}`);
  if (detail) say(detail);
  throw new Stop(message);
}

// ---------- hidden key prompt ----------

function readHidden(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    // Not an interactive terminal (for example, input piped in): read one visible line.
    const rl = readline.createInterface({ input: stdin, terminal: false });
    return new Promise(resolve => {
      stdout.write(question);
      rl.once('line', line => { resolve(line); rl.close(); });
      rl.once('close', () => resolve(''));
    });
  }
  return new Promise(resolve => {
    let value = '';
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(value);
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { finish(); return; }
        if (ch === '\u0003') { stdin.setRawMode(false); stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// ---------- helpers ----------

const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function dayLabel(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const text = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return String(iso).slice(0, 10) === isoDay(new Date()) ? `${text} (today, so far)` : text;
}

function tokenClaims(jwt) {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Numbers anywhere in a day's record whose field path mentions calories.
function calorieNumbers(value, path = '', out = [], depth = 0) {
  if (value == null || depth > 4 || typeof value !== 'object') return out;
  const entries = Array.isArray(value) ? value.map((v, i) => [`[${i}]`, v]) : Object.entries(value);
  for (const [k, v] of entries) {
    const p = Array.isArray(value) ? `${path}${k}` : (path ? `${path}.${k}` : k);
    if (typeof v === 'number' && CALORIE_FIELD.test(p)) out.push([p, v]);
    else if (v && typeof v === 'object') calorieNumbers(v, p, out, depth + 1);
  }
  return out;
}

async function call(url, options, what) {
  try {
    return await fetch(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, ...options.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const code = err?.cause?.code || err?.code || err?.name || '';
    let hint = 'Check your internet connection and try again.';
    if (/CERT|SELF_SIGNED|UNABLE_TO/i.test(code)) {
      hint = 'Your network inspects secure connections. Run the command again with --use-system-ca after "node".';
    } else if (code === 'TimeoutError') {
      hint = 'Garmin took too long to answer. Try again in a minute.';
    }
    fail(`couldn't reach Garmin to ${what} (${code || err?.message || 'unknown error'}).`, hint);
  }
}

// ---------- main ----------

async function main() {
  say('Garmin Personal API check');
  say('-------------------------');

  let key = process.env.GARMIN_PERSONAL_API_KEY || '';
  if (key) say('Using the key from GARMIN_PERSONAL_API_KEY.');
  else key = await readHidden('Paste your Garmin Personal API key, then press Enter (it stays hidden): ');
  key = key.trim().replace(/^["']|["']$/g, '');
  if (!key) fail('no key was entered.');
  secrets.push(key);
  say(`Key received (${key.length} characters). Asking Garmin for an access token...`);

  const tokenRes = await call(BASE + TOKEN_PATH, {
    method: 'POST',
    headers: { Accept: '*/*', Authorization: `ApiKey ${key}` },
  }, 'get an access token');
  const tokenBody = (await tokenRes.text()).trim();
  if (!tokenRes.ok) {
    const why = tokenRes.status === 401 || tokenRes.status === 403
      ? `Garmin rejected the key (HTTP ${tokenRes.status}). Check you copied all of it, or delete it in Garmin Connect and create a new one.`
      : `Garmin answered HTTP ${tokenRes.status} when asked for a token.`;
    fail(why, tokenBody ? `Garmin said: ${tokenBody.slice(0, 300)}` : '');
  }
  const token = tokenBody;
  secrets.push(token);

  const claims = tokenClaims(token);
  const expires = claims?.exp ? new Date(claims.exp * 1000).toLocaleString() : 'unknown';
  say(`OK: access token received, valid until ${expires}.`);
  const scopes = claims && (claims.scope || claims.scp || claims.authorities || claims.scopes);
  if (scopes) say(`Data this token can read: ${[].concat(scopes).join(', ')}`);

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (DAYS - 1));
  const query = new URLSearchParams({ startDate: isoDay(start), endDate: isoDay(end) });
  say(`Reading your daily summaries for ${isoDay(start)} to ${isoDay(end)}...`);

  const dataRes = await call(`${BASE}${DAILY_PATH}?${query}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  }, 'read your daily summaries');
  const dataText = await dataRes.text();
  if (!dataRes.ok) {
    fail(`Garmin answered HTTP ${dataRes.status} when reading your daily summaries.`,
      dataText ? `Garmin said: ${dataText.slice(0, 300)}` : '');
  }
  if (!dataText.trim()) {
    fail('Garmin returned no data for these days.', 'Open the Garmin Connect app so your watch syncs, then run this again.');
  }

  let json;
  try { json = JSON.parse(dataText); } catch { fail('Garmin sent something that isn\'t JSON.', dataText.slice(0, 300)); }
  const days = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!days) {
    say('');
    say(`The reply has an unexpected shape. Its top-level fields are: ${Object.keys(json || {}).join(', ') || '(none)'}`);
    say('Send me this line and I\'ll adapt the app to it.');
    return;
  }
  if (!days.length) {
    fail('Garmin returned an empty list for these days.', 'Open the Garmin Connect app so your watch syncs, then run this again.');
  }

  const dateOf = d => DATE_FIELDS.map(f => d?.[f]).find(v => typeof v === 'string') || '';
  const sorted = [...days].sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a))));
  const fieldNames = new Set();
  let anyCalories = false;

  for (const [i, day] of sorted.entries()) {
    Object.keys(day || {}).forEach(k => fieldNames.add(k));
    const date = dateOf(day);
    say('');
    say(date ? dayLabel(date) : `Day ${i + 1}`);
    const cals = calorieNumbers(day).slice(0, 20);
    if (!cals.length) say('  (no calorie fields in this day)');
    const width = Math.max(0, ...cals.map(([p]) => p.length));
    for (const [p, v] of cals) say(`  ${p.padEnd(width)}  ${Math.round(v).toLocaleString()}`);
    if (cals.length) anyCalories = true;
    for (const [k, v] of Object.entries(day || {})) {
      if (SYNC_FIELD.test(k) && (typeof v === 'string' || typeof v === 'number')) say(`  ${k}: ${v}`);
    }
  }

  say('');
  say(`Fields Garmin returns for a day: ${[...fieldNames].sort().join(', ')}`);
  say('');
  if (anyCalories) {
    say('How to read this: compare today\'s numbers with the Calories card in the Garmin Connect app.');
    say('If they match, the live sync works. Today only counts up to your watch\'s last sync.');
  } else {
    say('No calorie fields came back. Send me the field list above and I\'ll find where Garmin keeps them.');
  }
  say('Nothing was saved. The key and token are forgotten now that this has finished.');
}

main().catch(err => {
  if (!(err instanceof Stop)) {
    say('');
    say(`Stopped: ${err?.message || String(err)}`);
  }
  process.exitCode = 1;
});
