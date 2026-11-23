// Today (and any earlier day): calories and the three macros against the day's target,
// Garmin's burn, the log by meal, the end-of-day recap and the composer bar.
import { state, save, day } from '../store.js';
import { dayTotals, targetFor, entryTotals, streaks, typicalActive } from '../nutrition.js';
import { esc, num, dayKey, addDays, dayTitle, dayLong, isDayKey, MEALS, timeText, ago } from '../util.js';
import { icon, ring, rerender, go, toast, standalone, macroLine } from '../ui.js';
import { hydrateThumbs } from '../photos.js';
import { garminConnected, syncGarmin } from '../garmin.js';
import { recapDay, friendlyError, hasKey } from '../ai.js';
import { startPhoto, openEntry } from './log.js';

let viewKey = dayKey();
let recapBusy = null;

const NUTRIENTS = [['kcal', 'Calories', ''], ['protein', 'Protein', ' g'], ['carbs', 'Carbs', ' g'], ['fat', 'Fat', ' g']];

function tile([k, label, unit], totals, target) {
  const eaten = totals[k];
  const goal = target[k];
  const left = goal - eaten;
  let tone = '';
  let value = num(Math.abs(left));
  let status = k === 'kcal' ? 'kcal left' : 'left';
  let mark = '';
  if (k === 'protein' && left <= 0) {
    tone = 'good';
    value = num(eaten);
    status = 'goal hit';
    mark = icon('check', 'inline');
  } else if (left < 0) {
    tone = k === 'kcal' ? 'critical' : 'warning';
    status = k === 'kcal' ? 'kcal over' : 'over';
    mark = icon('alert', 'inline');
  }
  const unitText = k === 'kcal' ? '' : unit;
  return `<div class="tile" role="group" aria-label="${label}: ${num(eaten)} of ${num(goal)}${unit || ' kcal'}, ${value}${unitText} ${status}">
    ${ring(goal ? eaten / goal : 0, tone || 'accent')}
    <div class="tile-text">
      <span class="tile-label">${label}</span>
      <span class="tile-value">${value}<small>${unitText}</small></span>
      <span class="tile-status ${tone ? `s-${tone}` : ''}">${mark}${status}</span>
      <span class="tile-sub">${num(eaten)} of ${num(goal)}${unit}</span>
    </div>
  </div>`;
}

function summary(key) {
  const target = targetFor(key);
  if (!target) {
    return `<section class="card nudge">
      <div class="nudge-icon">${icon('body')}</div>
      <div><p class="nudge-title">Set your daily targets</p>
      <p class="muted small">Snap your Evolt scan and Claude works out your calories and macros.</p>
      <a class="btn primary sm" href="#/body">Set targets</a></div></section>`;
  }
  const totals = dayTotals(key);
  return `<section class="tiles" aria-label="Totals for ${esc(dayTitle(key))}">${NUTRIENTS.map(n => tile(n, totals, target)).join('')}</section>`;
}

function burnRow(key) {
  if (!garminConnected()) return '';
  const b = state.burn[key];
  const target = targetFor(key);
  const g = state.garmin;
  if (!b) {
    return `<button class="burn" data-act="garmin-sync">${icon('watch')}<span class="burn-text">${g.lastError ? esc(g.lastError) : 'No Garmin data for this day yet.'}</span>${icon('refresh', 'end')}</button>`;
  }
  const typical = typicalActive(key);
  const flex = target?.flex || 0;
  let note = '';
  if (flex > 0) note = `+${num(flex)} kcal added for activity`;
  else if (flex < 0) note = `${num(flex)} kcal for a quiet day`;
  else if (typical == null) note = 'Learning your typical day';
  else if (key === dayKey()) note = `Typical day: ${num(typical)} active`;
  return `<button class="burn" data-act="garmin-sync" aria-label="Garmin: ${num(b.active)} active calories, ${num(b.total)} burned. Tap to refresh.">
    ${icon('watch')}
    <span class="burn-text"><span><b>${num(b.active)}</b> active · <b>${num(b.total)}</b> burned</span>
      <small>${note ? `${esc(note)} · ` : ''}${key === dayKey() ? `synced ${ago(g.lastSync)}` : 'from Garmin'}</small></span>
    ${icon('refresh', 'end')}
  </button>`;
}

function entryRow(e) {
  const t = entryTotals(e);
  return `<button class="row entry" data-act="open-entry" data-id="${esc(e.id)}">
    ${e.photoId ? `<img class="thumb" data-thumb="${esc(e.photoId)}" alt="">` : `<span class="thumb ph">${icon(e.source === 'manual' ? 'edit' : 'today')}</span>`}
    <span class="row-main"><span class="row-title">${esc(e.title)}</span><span class="row-sub">${macroLine(t)} · ${timeText(e.at)}</span></span>
    <span class="entry-kcal">${num(t.kcal)}</span>
  </button>`;
}

function logList(key) {
  const entries = [...day(key).entries].sort((a, b) => a.at - b.at);
  if (!entries.length) {
    return `<div class="empty-log">${icon('today')}<p><b>Nothing logged ${key === dayKey() ? 'yet' : 'on this day'}</b></p>
      <p>Snap a photo or type what you ate. Claude does the math, and you confirm before anything is logged.</p></div>`;
  }
  return MEALS.map(([m, label]) => {
    const list = entries.filter(e => (e.meal || 'snack') === m);
    if (!list.length) return '';
    const kcal = list.reduce((s, e) => s + entryTotals(e).kcal, 0);
    return `<h2 class="label meal-head"><span>${label}</span><span>${num(kcal)} kcal</span></h2>
      <div class="card list">${list.map(entryRow).join('')}</div>`;
  }).join('');
}

const GRADES = { great: ['Great day', 'good', 'checkCircle'], solid: ['Solid', 'good', 'checkCircle'], mixed: ['Mixed', 'warning', 'alert'], off: ['Off track', 'critical', 'alert'] };

function recapCard(key) {
  const d = day(key);
  if (!d.entries.length) return '';
  if (recapBusy === key) {
    return '<section class="card recap"><div class="an-busy"><span class="spinner" aria-hidden="true"></span><span role="status">Writing your recap…</span></div></section>';
  }
  if (d.recap) {
    const [label, tone, ic] = GRADES[d.recap.grade] || GRADES.mixed;
    return `<section class="card recap">
      <div class="recap-head"><span class="tag t-${tone}">${icon(ic, 'inline')} ${label}</span><button class="mini ghost" data-act="recap" data-key="${key}">Redo</button></div>
      <h3>${esc(d.recap.headline)}</h3>
      ${d.recap.went_well ? `<p><b>Went well:</b> ${esc(d.recap.went_well)}</p>` : ''}
      ${d.recap.fix ? `<p><b>Tomorrow:</b> ${esc(d.recap.fix)}</p>` : ''}
      ${d.recap.coach ? `<p class="coach">${esc(d.recap.coach)}</p>` : ''}
    </section>`;
  }
  return `<button class="btn secondary wide recap-btn" data-act="recap" data-key="${key}">${icon('sparkle')}Wrap up ${key === dayKey() ? 'today' : 'this day'}</button>`;
}

function nudges() {
  const out = [];
  if (!standalone() && !state.tipsSeen.install) {
    out.push(`<div class="tip"><div><p class="tip-title">Add Plate to your Home Screen</p>
      <p>In Safari, tap ${icon('share', 'inline')} <b>Share</b>, then <b>Add to Home Screen</b>. Set it up in the Home Screen app: it keeps its own storage, separate from Safari.</p></div>
      <button class="icon-btn" data-act="dismiss-tip" data-v="install" aria-label="Dismiss">${icon('close')}</button></div>`);
  }
  if (!hasKey()) {
    out.push(`<a class="card nudge" href="#/settings"><div class="nudge-icon">${icon('key')}</div>
      <div><p class="nudge-title">Connect Claude</p><p class="muted small">Add your Anthropic API key so Claude can read your photos and descriptions.</p></div>${icon('chev', 'end')}</a>`);
  }
  return out.join('');
}

function view(key) {
  viewKey = isDayKey(key) ? key : dayKey();
  const k = viewKey;
  const today = dayKey();
  const st = streaks(today);
  return `
  <header class="top day-top">
    <div class="day-nav">
      <button class="icon-btn" data-act="day-shift" data-d="-1" aria-label="Previous day">${icon('back')}</button>
      <p class="eyebrow">${esc(dayLong(k))}</p>
      <button class="icon-btn" data-act="day-shift" data-d="1" aria-label="Next day" ${k >= today ? 'disabled' : ''}>${icon('chev')}</button>
      ${st.logged ? `<a class="streak" href="#/trends" aria-label="${st.logged}-day logging streak">${icon('flame')}${st.logged}</a>` : ''}
    </div>
    <div class="title-row"><h1>${esc(dayTitle(k))}</h1>${k !== today ? '<a class="pill" href="#/">Back to today</a>' : ''}</div>
  </header>
  ${nudges()}
  ${summary(k)}
  ${burnRow(k)}
  ${logList(k)}
  ${recapCard(k)}
  <div class="composer" role="region" aria-label="Log food">
    <label class="cb-btn" aria-label="Take a photo">${icon('camera')}<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-bind="photo-in"></label>
    <button class="cb-field" data-act="compose" data-key="${k}">${k === today ? 'Log food, or ask “should I…?”' : `Add to ${esc(dayTitle(k))}`}</button>
    <label class="cb-btn" aria-label="Choose a photo">${icon('image')}<input type="file" accept="image/*" class="visually-hidden" data-bind="photo-in"></label>
  </div>`;
}

function mount() {
  hydrateThumbs(document.getElementById('app'));
  if (garminConnected()) {
    syncGarmin().then(changed => { if (changed && document.querySelector('.day-top')) rerender(); }).catch(() => {});
  }
}

async function runRecap(key) {
  if (!hasKey()) { toast('Add your Anthropic API key first.'); go('#/settings'); return; }
  recapBusy = key;
  rerender();
  try {
    const r = await recapDay(key);
    day(key, true).recap = r;
    save();
  } catch (e) {
    toast(friendlyError(e), { ms: 6000 });
  } finally {
    recapBusy = null;
    rerender();
  }
}

export const actions = {
  'day-shift': el => {
    const next = addDays(viewKey, +el.dataset.d);
    if (next > dayKey()) return;
    go(next === dayKey() ? '#/' : `#/day/${next}`);
  },
  'open-entry': el => openEntry(viewKey, el.dataset.id),
  recap: el => runRecap(el.dataset.key || viewKey),
  'garmin-sync': () => {
    toast('Syncing with Garmin…', { ms: 1500 });
    syncGarmin({ force: true }).then(() => { rerender(); toast('Garmin synced'); }).catch(e => toast(e.message, { ms: 6000 }));
  },
  'dismiss-tip': el => { state.tipsSeen[el.dataset.v] = true; save(); rerender(); },
};

export const binds = {
  'photo-in': el => {
    const file = el.files?.[0];
    el.value = '';
    if (file) startPhoto(file, viewKey);
  },
};

export const routes = {
  today: { html: () => view(dayKey()), mount, tab: 'today', composer: true },
  day: { html: p => view(p), mount, tab: 'today', composer: true },
};
