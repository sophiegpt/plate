// Claude: food analysis (photo, text or both), body-scan reading and the end-of-day
// recap. Requests go straight from this phone to Anthropic with the user's own key.
import Anthropic from './vendor/anthropic.js';
import { state, save, day, getApiKey } from './store.js';
import { dayTotals, entryTotals, targetFor, patternText, GOALS } from './nutrition.js';
import { dayKey, dayLong, addDays, timeText, monthKey, sleep, MEAL_KEYS, mealFor } from './util.js';

// Prices are US$ per million tokens. Typed entries and photos can use different models.
export const MODELS = {
  'claude-haiku-5-5': { label: 'Haiku 5.5', short: 'Haiku', blurb: 'Fastest and cheapest: a fraction of a cent per request', price: { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', short: 'Sonnet', blurb: 'Strong and quick: about 2–4¢ per photo', price: { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
  'claude-opus-5-5': { label: 'Opus 5.5', short: 'Opus', blurb: 'More careful: about 5–8¢ per photo', price: { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 } },
  'claude-fable-5-2': { label: 'Fable 5.2', short: 'Fable', blurb: 'Most capable: about 10–15¢ per photo', price: { in: 8, out: 40, cacheRead: 0.2, cacheWrite: 10 } },
};
const OTHER_PRICE = { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }; // a server-side fallback model
// Haiku has no server-side refusal fallback, so only the others ask for one.
const WITH_FALLBACKS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']);
export const EFFORTS = { low: 'Fast', medium: 'Balanced', high: 'Thorough' };

// Which model a request uses: typed entries use the quick model; photos, scans and
// recaps use the main one.
export const modelFor = kind => (kind === 'text' ? state.settings.quickModel : state.settings.mainModel) || 'claude-sonnet-5-5';

// ?mock on localhost returns canned answers, for testing the screens without a key.
export const MOCK = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname) && /[?&]mock\b/.test(location.search);
export const hasKey = () => MOCK || !!getApiKey();
export const modelLabel = id => MODELS[id]?.label || id;

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- client and errors ----------

let client = null;
let clientKey = '';

function getClient() {
  const key = getApiKey();
  if (!key) throw new AiError('nokey', 'Add your Anthropic API key in Settings first.');
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180000 });
    clientKey = key;
  }
  return client;
}

const is = (e, name) => !!Anthropic[name] && e instanceof Anthropic[name];
export const isAbort = e => is(e, 'APIUserAbortError') || e?.name === 'AbortError';
const apiMessage = e => e?.error?.error?.message || e?.error?.message || e?.message || '';

export function friendlyError(e) {
  if (e instanceof AiError) return e.message;
  if (isAbort(e)) return 'Cancelled.';
  if (is(e, 'AuthenticationError')) return 'Your Anthropic API key was rejected. Check it in Settings.';
  if (is(e, 'PermissionDeniedError')) return 'Your API key isn\'t allowed to use this model. Pick another model in Settings.';
  if (is(e, 'NotFoundError')) return 'That model isn\'t available on your account. Pick another one in Settings.';
  if (is(e, 'PaymentRequiredError')) return 'Your Anthropic account is out of credit. Add some at platform.claude.com, then try again.';
  if (is(e, 'RateLimitError')) return 'Too many requests at once. Wait a minute and try again.';
  if (is(e, 'OverloadedError') || e?.status === 529) return 'Claude is overloaded right now. Try again in a minute.';
  if (is(e, 'APIConnectionTimeoutError') || is(e, 'RequestTimeoutError') || is(e, 'GatewayTimeoutError')) return 'Claude took too long to answer. Try again.';
  if (is(e, 'APIConnectionError')) {
    return navigator.onLine === false ? 'You\'re offline. Try again when you have signal.' : 'Couldn\'t reach Claude. Check your connection and try again.';
  }
  if (is(e, 'InternalServerError')) return 'Claude had a problem on its side. Try again in a minute.';
  if (is(e, 'BadRequestError') || is(e, 'ContentTooLargeError')) return `Claude couldn't take that request: ${apiMessage(e)}`;
  if (is(e, 'APIError')) return `Claude returned an error${e.status ? ` (${e.status})` : ''}: ${apiMessage(e)}`;
  return e?.message || 'Something went wrong.';
}

// ---------- spend tracking (estimated from token counts) ----------

function track(msg) {
  const p = MODELS[msg?.model]?.price || OTHER_PRICE;
  const u = msg?.usage || {};
  const usd = ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out
    + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6
    + (u.server_tool_use?.web_search_requests || 0) * 0.01;
  const m = monthKey();
  const rec = state.usage[m] || (state.usage[m] = { usd: 0, calls: 0 });
  rec.usd += usd;
  rec.calls += 1;
  save();
}

export const spend = (month = monthKey()) => state.usage[month] || { usd: 0, calls: 0 };

// ---------- one request, streamed ----------

// Streams the request (keeps the connection alive on mobile networks and lets the
// sheet say what Claude is doing), continues paused server-tool turns, and adds the
// server-side refusal fallback. If the API rejects an optional feature with a 400,
// it retries once without the extras and remembers that for later requests.
async function run(params, { signal, onStatus } = {}) {
  const c = getClient();
  const attempt = async safe => {
    const body = { ...params };
    if (!safe && WITH_FALLBACKS.has(body.model)) {
      body.betas = ['server-side-fallback-2026-07-01'];
      body.fallbacks = 'default';
    }
    if (safe && body.tools) {
      body.tools = body.tools.map(t => {
        if (t.type) return t;
        const { strict, eager_input_streaming: eager, ...rest } = t;
        return rest;
      });
    }
    let messages = body.messages;
    for (let turn = 0; turn < 4; turn++) {
      const stream = c.beta.messages.stream({ ...body, messages }, { signal });
      stream.on('streamEvent', ev => {
        if (ev.type !== 'content_block_start') return;
        const t = ev.content_block?.type;
        if (t === 'server_tool_use' || t === 'web_search_tool_result') onStatus?.('search');
        else if (t === 'tool_use') onStatus?.('record');
        else if (t === 'thinking') onStatus?.('think');
      });
      const msg = await stream.finalMessage();
      track(msg);
      if (msg.stop_reason !== 'pause_turn') return msg;
      messages = [...messages, { role: 'assistant', content: msg.content }];
    }
    throw new AiError('loop', 'Claude took too many steps. Try again.');
  };
  if (state.compat.safe) return attempt(true);
  try {
    return await attempt(false);
  } catch (e) {
    if (!is(e, 'BadRequestError')) throw e;
    const msg = await attempt(true);
    state.compat.safe = true;
    save();
    return msg;
  }
}

function jsonFromText(msg) {
  if (msg.stop_reason === 'refusal') throw new AiError('refusal', 'Claude declined this one. Try a different photo.');
  if (msg.stop_reason === 'max_tokens') throw new AiError('cut', 'Claude ran out of room before finishing. Try again.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new AiError('noresult', 'Claude\'s answer couldn\'t be read. Try again.');
}

// ---------- prompts ----------

const TONES = {
  tough: 'Tough love. Be blunt, specific and on their side. Use the numbers, name the pattern when recent days show one (several days over, protein short again, late-night snacking) and say exactly what to do next. Give credit when it is earned. Never shame, never moralize about food, never comment on their body.',
  straight: 'Straight talk. Direct and brief, numbers first, no judgement.',
  gentle: 'Gentle and encouraging. Notice what is going well and frame changes as small next steps.',
};

const SWAPS = {
  auto: 'Give 2–3 alternatives only when the verdict is "tight" or "over", or when the food is low in protein for its calories. Otherwise return an empty list. For advice questions, give 2–4 suggestions that fit what is left.',
  always: 'Always give 2–3 realistic alternatives that would fit the day better, even when the food fits. For advice questions, give 2–4 suggestions that fit what is left.',
  ask: 'Return an empty alternatives list unless intent is "advice" or the user asks for alternatives.',
};

function foodSystem(s) {
  return `You are the nutrition engine and accountability coach inside Plate, a personal calorie tracker on the user's iPhone. Each request gives you the user's day so far and one new input: a photo, a typed description, or both. Work out what the food is, estimate calories and macros, judge whether it fits the day, and report by calling the record_food tool exactly once, as your final step.

## What the input can be
- A log: food the user ate or is eating ("2 eggs on toast and a flat white", a photo of their plate). intent = "log".
- A check: food they are considering ("should I get a croissant?", a photo of a menu or a snack in their hand). intent = "check".
- A question with no specific food ("what should I have for dinner?", "how am I doing?"). intent = "advice": leave entries empty, answer in coach, and put concrete suggestions in alternatives.
A photo of a plated meal with no text is a log. A question about one specific food is a check.

## Estimating
- Identify every distinct food and drink. Be specific about preparation (grilled or fried, sauces, dressings, cooking oil, milk type) and portion (grams or household measures).
- Estimate like an experienced dietitian: realistic portions, not idealized ones. Restaurant, cafe and takeaway food usually carries more oil, butter and sauce than home cooking; include it. Count drinks, condiments and spreads that are visible or mentioned.
- In photos, use scale cues: plate and bowl size (a dinner plate is about 27 cm), cutlery, hands, packaging.
- If a nutrition label or a menu with calories is visible, use its numbers exactly, scaled to the amount eaten. Convert kilojoules to kcal (kJ ÷ 4.184).
- If the user names a restaurant chain or a packaged branded product and the web_search tool is available, search for its official nutrition information first (one or two searches; prefer the brand's own site), use it, and say so in source_note. Never search for generic foods.
- Keep totals consistent: kcal ≈ 4 × protein + 4 × carbs + 9 × fat (+ 7 per gram of alcohol), within about 10%.
- Round kcal to the nearest 5 and macros to whole grams.
- confidence: "high" for labels, official data or simple measured foods; "medium" for clear photos or specific descriptions; "low" when the portion or ingredients are a guess. When low, put one short question in clarify (for example "Was that whole milk or skim?") and still give your best estimate. Otherwise clarify is an empty string.
- If a photo shows no food or drink, set intent to "advice", leave entries empty and say what you see in what_i_see.

## Grouping
- One entry per meal or separately eaten item. A burrito bowl is one entry with several items; "eggs for breakfast and a protein bar later" is two entries.
- meal: use the meal the user names; otherwise infer it from the food and the local time.

## Verdict
You are given exact numbers for the day. Add this food (all entries together) and compare with the calorie target.
- "fits": calories stay within the target with room to spare, and the food doesn't crowd out the protein still needed.
- "tight": it fits but leaves under about 150 kcal, or it is poor value (many calories, little protein) for what is left.
- "over": calories end above the target.
- "none": for advice questions.
For a log the food is already eaten, so the verdict tells them what the rest of the day has to look like. For a check it is your recommendation: have it, have less, or skip it.

## Alternatives
${SWAPS[s.swaps] || SWAPS.auto}
Every alternative needs realistic numbers. Prefer swaps available at the same place, or easy to get.

## Coach voice
${TONES[s.tone] || TONES.tough}
Write coach in the second person, 1–3 short sentences, using the real numbers. No emojis, no hashtags, no generic health lectures.

## Output
Call record_food once with your final analysis. Don't write a separate answer.`;
}

const N = { type: 'number' };
const RECORD_TOOL = {
  name: 'record_food',
  description: 'Report the final analysis of the user\'s food or question. Call exactly once, at the end.',
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['log', 'check', 'advice'] },
      what_i_see: { type: 'string', description: 'One sentence naming the food (for a photo: what you see). Empty for advice.' },
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short name, e.g. "Chicken burrito bowl"' },
            meal: { type: 'string', enum: MEAL_KEYS },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  portion: { type: 'string', description: 'e.g. "1 cup (200 g)"' },
                  kcal: N, protein_g: N, carbs_g: N, fat_g: N,
                },
                required: ['name', 'portion', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
                additionalProperties: false,
              },
            },
          },
          required: ['title', 'meal', 'items'],
          additionalProperties: false,
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      clarify: { type: 'string', description: 'One short clarifying question when confidence is low, else empty.' },
      source_note: { type: 'string', description: 'Where the numbers came from when it is not your own estimate (e.g. "Nutrition label", "Official Sweetgreen nutrition"), else empty.' },
      verdict: { type: 'string', enum: ['fits', 'tight', 'over', 'none'] },
      coach: { type: 'string', description: '1–3 short sentences to the user.' },
      alternatives: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            why: { type: 'string', description: 'One short reason' },
            kcal: N, protein_g: N, carbs_g: N, fat_g: N,
          },
          required: ['name', 'why', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
          additionalProperties: false,
        },
      },
    },
    required: ['intent', 'what_i_see', 'entries', 'confidence', 'clarify', 'source_note', 'verdict', 'coach', 'alternatives'],
    additionalProperties: false,
  },
};

const t4 = t => `${t.kcal} kcal, protein ${t.protein} g, carbs ${t.carbs} g, fat ${t.fat} g`;

function dayContext(key, { exclude } = {}) {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const lines = [`Local time now: ${now.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${tz ? ` (${tz})` : ''}.`];
  if (key !== dayKey()) lines.push(`This is being logged onto an earlier day: ${dayLong(key)}.`);
  const target = targetFor(key);
  const eaten = dayTotals(key, { exclude });
  if (target) {
    const goal = GOALS[state.profile.goal] || GOALS.recomp;
    lines.push(`Goal: ${goal.label} (${goal.blurb}). Daily target: ${t4(target)}${target.flex ? ` (includes ${target.flex > 0 ? '+' : ''}${target.flex} kcal for Garmin activity)` : ''}.`);
    lines.push(`Eaten so far: ${t4(eaten)}.`);
    lines.push(`Left before this food: ${t4({ kcal: target.kcal - eaten.kcal, protein: target.protein - eaten.protein, carbs: target.carbs - eaten.carbs, fat: target.fat - eaten.fat })}.`);
  } else {
    lines.push(`No targets set yet, so judge against a typical 2,000 kcal day and mention that targets aren't set. Eaten so far: ${t4(eaten)}.`);
  }
  const b = state.burn[key];
  if (b) lines.push(`Garmin so far on this day: ${b.active} active kcal, ${b.total} kcal burned in total.`);
  const entries = day(key).entries.filter(e => e.id !== exclude);
  lines.push(entries.length
    ? `Already logged:\n${entries.map(e => { const t = entryTotals(e); return `- ${timeText(e.at)} ${e.meal}: ${e.title} (${t.kcal} kcal, protein ${t.protein} g)`; }).join('\n')}`
    : 'Nothing logged yet on this day.');
  lines.push(patternText(key));
  const notes = state.settings.notes.trim();
  if (notes) lines.push(`The user's own food notes (preferences, allergies): ${notes}`);
  return lines.join('\n');
}

const compact = r => ({
  intent: r.intent,
  what_i_see: r.what_i_see,
  entries: r.entries.map(e => ({ title: e.title, meal: e.meal, items: e.items.map(it => ({ name: it.name, portion: it.portion, kcal: it.kcal, protein_g: it.protein, carbs_g: it.carbs, fat_g: it.fat })) })),
});

function foodPrompt({ key, text, image, refine }) {
  const parts = [dayContext(key, { exclude: refine?.entryId })];
  if (refine?.previous) {
    parts.push(`Your previous analysis of this food:\n${JSON.stringify(compact(refine.previous))}`);
    if (refine.originalText) parts.push(`The user's original words: "${refine.originalText}"`);
    parts.push(`The user's correction: "${text}"\nRedo the analysis with the correction applied${image ? ' (the same photo is attached)' : ''}.`);
  } else if (image) {
    parts.push(text ? `New input: the attached photo, with the user's note: "${text}"` : 'New input: the attached photo.');
  } else {
    parts.push(`New input: "${text}"`);
  }
  return parts.join('\n\n');
}

// ---------- reading the answer ----------

const lc = v => String(v ?? '').toLowerCase().trim();
const n0 = v => Math.max(0, Math.round(Number(v) || 0));
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export function normRecord(x) {
  if (!x || typeof x !== 'object') throw new AiError('noresult', 'Claude didn\'t return any numbers. Try again, or add a bit more detail.');
  const entries = (Array.isArray(x.entries) ? x.entries : []).map(e => ({
    title: str(e?.title, 80) || 'Food',
    meal: MEAL_KEYS.includes(lc(e?.meal)) ? lc(e.meal) : null,
    items: (Array.isArray(e?.items) ? e.items : []).map(it => ({
      name: str(it?.name, 80) || 'Item',
      portion: str(it?.portion, 60),
      kcal: n0(it?.kcal), protein: n0(it?.protein_g ?? it?.protein), carbs: n0(it?.carbs_g ?? it?.carbs), fat: n0(it?.fat_g ?? it?.fat),
    })),
  })).filter(e => e.items.length);
  let intent = ['log', 'check', 'advice'].includes(lc(x.intent)) ? lc(x.intent) : 'log';
  if (!entries.length && intent !== 'advice') intent = 'advice';
  const coach = str(x.coach, 600);
  if (!entries.length && !coach) throw new AiError('noresult', 'Claude didn\'t return any numbers. Try again, or add a bit more detail.');
  return {
    intent,
    what_i_see: str(x.what_i_see, 300),
    entries,
    confidence: ['high', 'medium', 'low'].includes(lc(x.confidence)) ? lc(x.confidence) : 'medium',
    clarify: str(x.clarify, 200),
    source_note: str(x.source_note, 160),
    verdict: ['fits', 'tight', 'over', 'none'].includes(lc(x.verdict)) ? lc(x.verdict) : 'none',
    coach,
    alternatives: (Array.isArray(x.alternatives) ? x.alternatives : []).slice(0, 4).map(a => ({
      name: str(a?.name, 80) || 'Option',
      why: str(a?.why, 160),
      kcal: n0(a?.kcal), protein: n0(a?.protein_g ?? a?.protein), carbs: n0(a?.carbs_g ?? a?.carbs), fat: n0(a?.fat_g ?? a?.fat),
    })),
  };
}

function extractRecord(msg) {
  if (msg.stop_reason === 'refusal') throw new AiError('refusal', 'Claude declined to analyze this one. Try another photo, or describe it in words.');
  const call = msg.content.find(b => b.type === 'tool_use' && b.name === 'record_food');
  if (msg.stop_reason === 'max_tokens') throw new AiError('cut', 'Claude ran out of room before finishing. Try again.');
  let input = call?.input;
  if (!input || typeof input !== 'object') {
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { input = JSON.parse(m[0]); } catch { input = null; } }
  }
  const rec = normRecord(input);
  rec.searched = msg.content.some(b => b.type === 'server_tool_use');
  return rec;
}

// ---------- public calls ----------

export async function analyzeFood({ text = '', image = null, key = dayKey(), refine = null, signal, onStatus } = {}) {
  if (MOCK) return mockFood({ text, image, refine, signal, onStatus });
  const s = state.settings;
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.base64 } });
  content.push({ type: 'text', text: foodPrompt({ key, text, image, refine }) });
  const tools = [];
  if (s.webLookup) {
    // The basic search tool calls the web directly. It sits beside a strict client tool,
    // so this avoids the code-execution sandbox the dynamic-filtering version brings in.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3, ...(tz ? { user_location: { type: 'approximate', timezone: tz } } : {}) });
  }
  tools.push(RECORD_TOOL);
  const params = {
    model: modelFor(image ? 'photo' : 'text'),
    max_tokens: 16000,
    system: [{ type: 'text', text: foodSystem(s), cache_control: { type: 'ephemeral' } }],
    tools,
    output_config: { effort: s.effort },
    messages: [{ role: 'user', content }],
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return extractRecord(await run(params, { signal, onStatus }));
    } catch (e) {
      // With eager input streaming the SDK parses the tool input itself, and JSON it
      // can't parse rejects as a plain error rather than an API error. Re-issue once.
      const parseFailure = !(e instanceof AiError) && !is(e, 'APIError') && !isAbort(e);
      if (parseFailure && attempt < 1) continue;
      throw e;
    }
  }
}

const SCAN_SYSTEM = 'You read body composition scan reports (for example Evolt 360, InBody or DEXA) from photos for a personal nutrition app. Extract the numbers exactly as printed. Convert pounds to kilograms (× 0.4536) where needed. Use 0 for any value that is not shown, and never guess a value that isn\'t printed. Set is_body_scan to false if the photo is not a body composition report. In summary, describe the body composition in plain words without judging appearance.';

const SCAN_SCHEMA = {
  type: 'object',
  properties: {
    is_body_scan: { type: 'boolean' },
    scan_date: { type: 'string', description: 'YYYY-MM-DD if printed, else empty' },
    weight_kg: N,
    body_fat_pct: N,
    fat_mass_kg: N,
    skeletal_muscle_kg: { type: 'number', description: 'Skeletal muscle mass' },
    lean_mass_kg: { type: 'number', description: 'Lean body mass or fat-free mass' },
    bmr_kcal: { type: 'number', description: 'Basal metabolic rate' },
    visceral_fat: N,
    age: N,
    height_cm: N,
    sex: { type: 'string', enum: ['female', 'male', 'unknown'] },
    other: { type: 'string', description: 'Other useful metrics in one line, e.g. "Total body water 34.1 L, biological age 27"' },
    summary: { type: 'string', description: 'Two plain sentences on what the scan shows.' },
  },
  required: ['is_body_scan', 'scan_date', 'weight_kg', 'body_fat_pct', 'fat_mass_kg', 'skeletal_muscle_kg', 'lean_mass_kg', 'bmr_kcal', 'visceral_fat', 'age', 'height_cm', 'sex', 'other', 'summary'],
  additionalProperties: false,
};

const pos = (v, dp = 1) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x * 10 ** dp) / 10 ** dp : 0; };

export function normScan(x) {
  if (!x || typeof x !== 'object') throw new AiError('noresult', 'Couldn\'t read that scan. Try a sharper photo.');
  if (x.is_body_scan === false) throw new AiError('notscan', 'That doesn\'t look like a body composition report. Try a photo of the printed or on-screen results.');
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(x.scan_date || '') ? x.scan_date : '',
    weightKg: pos(x.weight_kg), bodyFatPct: pos(x.body_fat_pct), fatMassKg: pos(x.fat_mass_kg),
    muscleKg: pos(x.skeletal_muscle_kg), leanKg: pos(x.lean_mass_kg), bmr: pos(x.bmr_kcal, 0),
    visceral: pos(x.visceral_fat), age: pos(x.age, 0), heightCm: pos(x.height_cm, 0),
    sex: ['female', 'male'].includes(lc(x.sex)) ? lc(x.sex) : '',
    other: str(x.other, 300), summary: str(x.summary, 500),
  };
}

export async function readScan(image, { signal, onStatus } = {}) {
  if (MOCK) return mockScan(signal);
  const msg = await run({
    model: modelFor('scan'),
    max_tokens: 8000,
    system: SCAN_SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCAN_SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.base64 } },
      { type: 'text', text: 'Read this body composition report.' },
    ] }],
  }, { signal, onStatus });
  return normScan(jsonFromText(msg));
}

const RECAP_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'At most 8 words: the honest verdict on the day' },
    grade: { type: 'string', enum: ['great', 'solid', 'mixed', 'off'] },
    went_well: { type: 'string' },
    fix_tomorrow: { type: 'string' },
    coach: { type: 'string' },
  },
  required: ['headline', 'grade', 'went_well', 'fix_tomorrow', 'coach'],
  additionalProperties: false,
};

function recapSystem(s) {
  return `You are the accountability coach inside Plate, a personal calorie tracker. Write an end-of-day recap from the user's logged food, their targets and their Garmin activity.
Voice: ${TONES[s.tone] || TONES.tough}
- headline: at most 8 words, the honest verdict on the day.
- grade: "great" (on target and protein hit), "solid" (close on both), "mixed" (one clear miss), "off" (well over, or protein far short).
- went_well: one specific sentence.
- fix_tomorrow: one concrete action for tomorrow, with a number where it helps.
- coach: 1–2 sentences in the second person, using real numbers and any pattern from recent days.
No emojis. Don't comment on the user's body or appearance. If little was logged, say the log looks incomplete rather than praising a low total.`;
}

function recapPrompt(key) {
  const entries = day(key).entries;
  const lines = [dayContext(key)];
  if (key === dayKey()) lines.push('The day may not be over yet; treat what is logged so far as the day.');
  lines.push(`Total logged: ${t4(dayTotals(key))} across ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
  return lines.join('\n\n');
}

export async function recapDay(key, { signal } = {}) {
  if (MOCK) return mockRecap(signal);
  const msg = await run({
    model: modelFor('recap'),
    max_tokens: 6000,
    system: recapSystem(state.settings),
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RECAP_SCHEMA } },
    messages: [{ role: 'user', content: recapPrompt(key) }],
  }, { signal });
  const x = jsonFromText(msg);
  return {
    headline: str(x.headline, 80),
    grade: ['great', 'solid', 'mixed', 'off'].includes(lc(x.grade)) ? lc(x.grade) : 'mixed',
    went_well: str(x.went_well, 300),
    fix: str(x.fix_tomorrow, 300),
    coach: str(x.coach, 400),
    at: Date.now(),
  };
}

// A free call that checks the key and that both chosen models are available.
// Returns their names, e.g. "Haiku 5.5 and Sonnet 5.5".
export async function testConnection() {
  const ids = [...new Set([modelFor('text'), modelFor('photo')])];
  if (MOCK) { await sleep(500); return ids.map(modelLabel).join(' and '); }
  const c = getClient();
  const found = await Promise.all(ids.map(id => c.models.retrieve(id)));
  return found.map((m, i) => m?.display_name || modelLabel(ids[i])).join(' and ');
}

// ---------- mock answers (localhost with ?mock) ----------

async function mockFood({ text, image, refine, signal, onStatus }) {
  await sleep(600, signal);
  onStatus?.('think');
  await sleep(900, signal);
  const t = lc(text);
  if (/mcdonald|sweetgreen|starbucks|subway|guzman|chipotle|nando/.test(t)) { onStatus?.('search'); await sleep(1100, signal); }
  onStatus?.('record');
  await sleep(400, signal);
  const target = targetFor(dayKey());
  const left = target ? target.kcal - dayTotals(dayKey()).kcal : 1200;
  if (/what should|what can|how am i/.test(t)) {
    return normRecord({
      intent: 'advice', what_i_see: '', entries: [], confidence: 'high', clarify: '', source_note: '', verdict: 'none',
      coach: `You have ${left} kcal left and protein is the gap. Make the next meal lean protein first, carbs second.`,
      alternatives: [
        { name: 'Grilled chicken, rice and greens', why: 'Big protein hit, fits what is left', kcal: 520, protein_g: 48, carbs_g: 55, fat_g: 10 },
        { name: 'Greek yogurt with berries', why: 'Light, 20 g protein', kcal: 210, protein_g: 20, carbs_g: 24, fat_g: 3 },
      ],
    });
  }
  if (/should i|thinking about|can i have/.test(t)) {
    return normRecord({
      intent: 'check', what_i_see: 'A plain butter croissant from a cafe.',
      entries: [{ title: 'Butter croissant', meal: 'snack', items: [{ name: 'Butter croissant', portion: '1 large (80 g)', kcal: 340, protein_g: 7, carbs_g: 37, fat_g: 18 }] }],
      confidence: 'medium', clarify: '', source_note: '', verdict: left - 340 < 150 ? 'tight' : 'fits',
      coach: 'It fits, but 340 kcal buys you 7 g of protein. Have it if you want it, then make dinner count.',
      alternatives: [
        { name: 'Half the croissant', why: 'Same taste, half the damage', kcal: 170, protein_g: 4, carbs_g: 18, fat_g: 9 },
        { name: 'Ham and cheese toastie', why: 'Similar calories, three times the protein', kcal: 360, protein_g: 22, carbs_g: 34, fat_g: 14 },
      ],
    });
  }
  const k = refine ? 0.8 : 1;
  if (image && (!t || refine)) {
    return normRecord({
      intent: 'log', what_i_see: 'A chicken burrito bowl with white rice, black beans, cheese, guacamole and salsa.',
      entries: [{ title: 'Chicken burrito bowl', meal: mealFor(), items: [
        { name: 'Grilled chicken', portion: '150 g', kcal: 250 * k, protein_g: 45 * k, carbs_g: 0, fat_g: 7 * k },
        { name: 'White rice', portion: '1 cup (180 g)', kcal: 235 * k, protein_g: 4, carbs_g: 52 * k, fat_g: 1 },
        { name: 'Black beans', portion: '½ cup', kcal: 110, protein_g: 7, carbs_g: 20, fat_g: 1 },
        { name: 'Cheese and guacamole', portion: '2 tbsp each', kcal: 190, protein_g: 4, carbs_g: 5, fat_g: 17 },
      ] }],
      confidence: 'medium', clarify: 'Was there sour cream under the salsa?', source_note: '', verdict: 'fits',
      coach: 'Solid lunch: 60 g of protein. Keep dinner lean and you finish on target.', alternatives: [],
    });
  }
  const parts = (text || 'Food').split(/,|\band\b|\n/i).map(s => s.trim()).filter(Boolean).slice(0, 4);
  return normRecord({
    intent: 'log', what_i_see: '',
    entries: [{ title: parts.join(', ').slice(0, 60), meal: mealFor(), items: parts.map(p => ({ name: p, portion: '1 serving', kcal: 180 * k, protein_g: 9, carbs_g: 18, fat_g: 7 })) }],
    confidence: 'medium', clarify: '', source_note: refine ? 'Corrected with your note' : '', verdict: 'fits',
    coach: 'Logged. Protein is lagging, so make the next meal lean protein and veg.', alternatives: [],
  });
}

async function mockScan(signal) {
  await sleep(1800, signal);
  return normScan({
    is_body_scan: true, scan_date: addDays(dayKey(), -3), weight_kg: 64.8, body_fat_pct: 24.1, fat_mass_kg: 15.6,
    skeletal_muscle_kg: 27.4, lean_mass_kg: 49.2, bmr_kcal: 1433, visceral_fat: 4, age: 0, height_cm: 0, sex: 'unknown',
    other: 'Total body water 35.8 L', summary: 'Body fat is in the healthy range with good muscle mass. Visceral fat is low.',
  });
}

async function mockRecap(signal) {
  await sleep(1200, signal);
  return { headline: 'On budget, protein still short', grade: 'mixed', went_well: 'Calories landed within 60 of your target.', fix: 'Add 30 g of protein at breakfast: Greek yogurt or eggs.', coach: 'Third day running you\'re short on protein. Fix breakfast and the rest follows.', at: Date.now() };
}
