// Body: daily targets (from a body scan or by hand), the adaptive "what you really
// burn" estimate, weight with its trend, and the list of scans.
import { state, save } from '../store.js';
import { computeTargets, balanceCarbs, adaptive, GOALS, ACTIVITY } from '../nutrition.js';
import { esc, num, uid, round, dayKey, addDays, dayTitle, dayShort, daysBetween, isDayKey } from '../util.js';
import { icon, openSheet, setSheet, sheetTag, closeSheet, toast, rerender, go, confirmSheet, bindTips } from '../ui.js';
import { prepareImage } from '../photos.js';
import { readScan, friendlyError, isAbort, hasKey } from '../ai.js';
import { garminConnected } from '../garmin.js';

let scan = null;     // the scan being read or confirmed
let editT = null;    // targets being edited
let calc = null;     // inputs for "calculate them for me"
const SOURCE_RANK = { manual: 3, scan: 2, garmin: 1 };

// ---------- weights ----------

// One weight per day: a weight typed into Plate beats a scan, which beats Garmin.
export function weightSeries() {
  const byDay = new Map();
  for (const w of state.weights) {
    const cur = byDay.get(w.date);
    if (!cur || (SOURCE_RANK[w.source] || 0) > (SOURCE_RANK[cur.source] || 0)) byDay.set(w.date, w);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function upsertWeight(date, kg, source) {
  const same = state.weights.find(w => w.date === date && w.source === source);
  if (same) same.kg = kg;
  else state.weights.push({ date, kg, source });
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
}

function weightChart(ws) {
  const W = 340;
  const H = 140;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const kgs = ws.map(w => w.kg);
  let lo = Math.floor(Math.min(...kgs) - 0.5);
  let hi = Math.ceil(Math.max(...kgs) + 0.5);
  if (hi - lo < 2) { lo -= 1; hi += 1; }
  const first = ws[0].date;
  const last = ws[ws.length - 1].date;
  const spanDays = Math.max(1, daysBetween(first, last));
  const plotW = W - padL - padR;
  const x = d => padL + (daysBetween(first, d) / spanDays) * plotW;
  const y = kg => padT + ((hi - kg) / (hi - lo)) * (H - padT - padB);
  const mid = (lo + hi) / 2;
  const ticks = [lo, mid, hi].map(v => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`).join('');
  const pts = ws.map(w => `${x(w.date).toFixed(1)},${y(w.kg).toFixed(1)}`).join(' ');
  const end = ws[ws.length - 1];
  const xs = ws.map(w => x(w.date));
  const hits = ws.map((w, i) => {
    const left = i ? (xs[i - 1] + xs[i]) / 2 : padL;
    const right = i < ws.length - 1 ? (xs[i] + xs[i + 1]) / 2 : W - padR;
    return `<rect class="hit" data-key="${w.date}" x="${left}" y="${padT}" width="${Math.max(2, right - left)}" height="${H - padT - padB}" tabindex="0" role="button" aria-label="${esc(`${dayTitle(w.date)}: ${w.kg.toFixed(1)} kg`)}"/>`;
  }).join('');
  return `<div class="chart-wrap">
    <svg class="chart weight-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight from ${dayShort(first)} to ${dayShort(last)}">
      ${ticks}
      <polyline class="line" points="${pts}"/>
      <circle class="end-dot" cx="${x(end.date)}" cy="${y(end.kg)}" r="4.5"/>
      <text class="axis" x="${padL}" y="${H - 6}">${esc(dayShort(first))}</text>
      <text class="axis" x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(dayShort(last))}</text>
      ${hits}
    </svg>
    <div class="chart-tip" role="status" hidden></div>
  </div>`;
}

const signed = (v, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`;

function weightCard() {
  const ws = weightSeries();
  const last = ws[ws.length - 1];
  const since = addDays(dayKey(), -30);
  const firstRecent = ws.find(w => w.date >= since);
  let change = '';
  if (last && firstRecent && firstRecent !== last) change = ` · ${signed(last.kg - firstRecent.kg)} kg since ${dayShort(firstRecent.date)}`;
  return `<section class="card pad">
    <div class="card-head"><h2 class="card-title">Weight</h2><button class="mini" data-act="log-weight">Log weight</button></div>
    ${last
      ? `<p class="big-number">${last.kg.toFixed(1)}<small> kg</small></p><p class="muted small">${esc(dayTitle(last.date))}${last.source === 'garmin' ? ' (Garmin)' : last.source === 'scan' ? ' (scan)' : ''}${change}</p>`
      : '<p class="muted small">No weigh-ins yet. Weigh in a few times a week at the same time of day for a trend you can trust.</p>'}
    ${ws.length >= 2 ? weightChart(ws.slice(-60)) : ''}
  </section>`;
}

function openWeight() {
  const ws = weightSeries();
  const last = ws[ws.length - 1];
  const recent = [...state.weights].filter(w => w.source === 'manual').slice(-5).reverse();
  openSheet(`
    <div class="sheet-head"><h3 class="sheet-title">Log weight</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
    <div class="field-row">
      <label class="field"><span>Weight</span><span class="num-input"><input id="w-kg" type="number" inputmode="decimal" step="0.1" min="20" max="400" value="${last ? last.kg.toFixed(1) : ''}" data-enter="w-save"><span>kg</span></span></label>
      <label class="field"><span>Date</span><input id="w-date" class="input" type="date" value="${dayKey()}" max="${dayKey()}"></label>
    </div>
    <div class="sheet-actions"><button class="btn primary" data-act="w-save">Save</button></div>
    ${recent.length ? `<h4 class="label">Logged here</h4><div class="card list">${recent.map(w => `<div class="row">
      <span class="row-main"><span class="row-title">${w.kg.toFixed(1)} kg</span><span class="row-sub">${esc(dayTitle(w.date))}</span></span>
      <button class="icon-btn" data-act="w-del" data-date="${w.date}" aria-label="Delete ${w.kg.toFixed(1)} kg on ${esc(dayTitle(w.date))}">${icon('trash')}</button></div>`).join('')}</div>` : ''}`, { tag: 'weight' });
  const input = document.getElementById('w-kg');
  input?.focus();
  input?.select?.();
}

// ---------- targets ----------

function basisText(t) {
  const b = t.basis;
  if (!b) return 'Set by you.';
  const goal = GOALS[b.goal];
  const bmrLabel = b.bmrSource === 'scan' ? 'Scan BMR' : b.bmrSource === 'lean' ? 'BMR from lean mass' : 'Estimated BMR';
  const adj = goal ? `, then ${goal.label.toLowerCase()} (${goal.adjust > 0 ? '+' : goal.adjust < 0 ? '−' : '±'}${Math.abs(Math.round(goal.adjust * 100))}%)` : '';
  const adaptiveNote = b.adaptive ? ' Calories updated from what you really burn.' : '';
  return `${bmrLabel} ${num(b.bmr)} × ${b.activity} for activity = ${num(b.maintenance)} kcal burned a day${adj}. Protein: ${b.proteinRule}.${adaptiveNote}`;
}

const scanButtons = (cls = 'btn secondary sm') => `
  <label class="${cls}">${icon('camera')}Snap a scan<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-bind="scan-in"></label>
  <label class="${cls}">${icon('image')}From Photos<input type="file" accept="image/*" class="visually-hidden" data-bind="scan-in"></label>`;

function targetsCard() {
  const t = state.targets;
  if (!t) {
    return `<section class="card pad setup">
      <h2 class="card-title">Set your daily targets</h2>
      <p class="muted small">Snap your Evolt 360 results (or any body-composition scan). Claude reads your BMR and lean mass and works out calories and macros. You check every number before it's saved.</p>
      <div class="btn-row">${scanButtons('btn primary')}</div>
      <button class="link-row" data-act="edit-targets">${icon('edit')}Enter or calculate them myself</button>
    </section>`;
  }
  return `<section class="card pad targets">
    <div class="card-head"><h2 class="card-title">Daily targets</h2><button class="mini" data-act="edit-targets">Edit</button></div>
    <div class="target-grid">
      <div><b>${num(t.kcal)}</b><span>kcal</span></div>
      <div><b>${num(t.protein)} g</b><span>protein</span></div>
      <div><b>${num(t.carbs)} g</b><span>carbs</span></div>
      <div><b>${num(t.fat)} g</b><span>fat</span></div>
    </div>
    <p class="hint">${esc(basisText(t))}</p>
    ${state.settings.flex && garminConnected() ? '<p class="hint">On days Garmin records more activity than usual, half the extra is added to calories, as carbs.</p>' : ''}
    <div class="btn-row">${scanButtons()}</div>
  </section>`;
}

function adaptiveCard() {
  if (!state.targets) return '';
  const a = adaptive();
  if (!a.ready) {
    const bar = (v, of) => `<div class="meter"><span style="width:${Math.min(100, (v / of) * 100).toFixed(0)}%"></span></div>`;
    const count = (v, of) => (v >= of ? `<b>${v}</b> ${icon('check', 'inline')}` : `<b>${v}</b> of ${of}`);
    return `<section class="card pad">
      <h2 class="card-title">What you really burn</h2>
      <p class="muted small">After 2–3 weeks of logging and a few weigh-ins, Plate compares what you ate with how your weight moved. That beats any watch's estimate.</p>
      <div class="meter-row"><div class="meter-head"><span>Days logged (last 4 weeks)</span><span>${count(a.progress.days, a.need.days)}</span></div>${bar(a.progress.days, a.need.days)}</div>
      <div class="meter-row"><div class="meter-head"><span>Weigh-ins, 10+ days apart</span><span>${count(a.progress.weighIns, a.need.weighIns)}</span></div>${bar(a.progress.weighIns, a.need.weighIns)}</div>
      ${a.odd ? '<p class="hint">The numbers don\'t add up yet: probably a missed log or a water-weight swing. Keep going.</p>' : ''}
    </section>`;
  }
  const t = state.targets;
  const goal = GOALS[state.profile.goal] || GOALS.recomp;
  const assumed = t.basis?.maintenance;
  return `<section class="card pad">
    <h2 class="card-title">What you really burn</h2>
    <p class="big-number">${num(a.maintenance)}<small> kcal a day</small></p>
    <p class="muted small">From ${a.progress.days} logged days averaging ${num(a.intake)} kcal, while your weight moved ${signed(a.perWeek, 2)} kg a week.${assumed ? ` Your targets assumed ${num(assumed)}.` : ''}</p>
    ${Math.abs(a.suggested - t.kcal) >= 50
      ? `<button class="btn secondary wide" data-act="use-adaptive" data-v="${a.suggested}" data-m="${a.maintenance}">Set calories to ${num(a.suggested)} (${esc(goal.label.toLowerCase())})</button>`
      : '<p class="hint">Your calorie target already matches.</p>'}
  </section>`;
}

function targetFields() {
  const f = (k, label, unit) => `<label class="field"><span>${label}</span><span class="num-input"><input id="t-${k}" type="number" inputmode="numeric" min="0" step="5" value="${editT[k] ?? ''}" data-bind="t-field" data-f="${k}"><span>${unit}</span></span></label>`;
  return `<div class="field-row">${f('kcal', 'Calories', 'kcal')}${f('protein', 'Protein', 'g')}</div>
    <div class="field-row">${f('carbs', 'Carbs', 'g')}${f('fat', 'Fat', 'g')}</div>`;
}

function macroCheck() {
  const fromMacros = (+editT.protein || 0) * 4 + (+editT.carbs || 0) * 4 + (+editT.fat || 0) * 9;
  const diff = fromMacros - (+editT.kcal || 0);
  if (Math.abs(diff) < 30) return 'Your macros add up to your calories.';
  return `Your macros add up to ${num(fromMacros)} kcal, ${num(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than your calories.`;
}

function targetsHTML() {
  const latest = state.scans[state.scans.length - 1];
  const seg = (act, items, cur) => items.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${esc(l)}</button>`).join('');
  const act = ACTIVITY.find(a => a.v === calc.activity) || ACTIVITY[1];
  return `
  <div class="sheet-head"><h3 class="sheet-title">Daily targets</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
  ${targetFields()}
  <p class="hint" id="t-check">${macroCheck()}</p>
  <button class="mini" data-act="t-balance">Fit carbs to the calories</button>
  <details class="more" ${state.targets ? '' : 'open'}><summary>Calculate them for me</summary>
    <h4 class="label">Goal</h4>
    <div class="seg sm" role="group" aria-label="Goal">${seg('t-goal', Object.entries(GOALS).map(([k, g]) => [k, g.label]), calc.goal)}</div>
    <p class="hint">${esc(GOALS[calc.goal].blurb)}</p>
    <h4 class="label">Activity</h4>
    <div class="seg sm" role="group" aria-label="Activity">${seg('t-activity', ACTIVITY.map(a => [a.v, a.label]), calc.activity)}</div>
    <p class="hint">${esc(act.blurb)}. Garmin then adds extra on unusually active days.</p>
    ${latest ? `<button class="btn secondary wide" data-act="t-calc" data-from="scan">Use my scan of ${esc(dayShort(latest.date))}</button>
      <p class="hint">BMR ${latest.bmr ? num(latest.bmr) : 'not shown'}${latest.leanKg ? ` · lean mass ${latest.leanKg} kg` : ''}${latest.weightKg ? ` · ${latest.weightKg} kg` : ''}</p>` : ''}
    <h4 class="label">${latest ? 'Or from basics' : 'From basics'}</h4>
    <div class="seg sm" role="group" aria-label="Sex, for the formula">${seg('t-sex', [['female', 'Female'], ['male', 'Male']], calc.sex)}</div>
    <div class="field-row">
      <label class="field"><span>Age</span><input id="c-age" class="input" type="number" inputmode="numeric" value="${calc.age ?? ''}" data-bind="c-field" data-f="age"></label>
      <label class="field"><span>Height cm</span><input id="c-height" class="input" type="number" inputmode="numeric" value="${calc.heightCm ?? ''}" data-bind="c-field" data-f="heightCm"></label>
      <label class="field"><span>Weight kg</span><input id="c-weight" class="input" type="number" inputmode="decimal" value="${calc.weightKg ?? ''}" data-bind="c-field" data-f="weightKg"></label>
    </div>
    <button class="btn secondary wide" data-act="t-calc" data-from="basics">Calculate</button>
  </details>
  <div class="sheet-actions"><button class="btn primary" data-act="t-save">Save targets</button></div>`;
}

function openTargets() {
  editT = { ...(state.targets || { kcal: '', protein: '', carbs: '', fat: '' }) };
  const ws = weightSeries();
  calc = {
    goal: state.profile.goal, activity: state.profile.activity, sex: state.profile.sex,
    age: state.profile.age, heightCm: state.profile.heightCm, weightKg: ws[ws.length - 1]?.kg ?? null,
  };
  openSheet(targetsHTML(), { tag: 'targets', cls: 'tall' });
}

function refreshTargets() {
  if (sheetTag() === 'targets') setSheet(targetsHTML());
}

// ---------- reading a scan ----------

export async function startScan(file, after = null) {
  if (!hasKey()) {
    toast('Connect Claude first so it can read your scan.');
    go('#/settings');
    return;
  }
  let image;
  try {
    image = await prepareImage(file, 2576, 0.9); // small print needs the full resolution
  } catch (e) {
    toast(e.message);
    return;
  }
  const s = { status: 'busy', image, controller: new AbortController(), goal: state.profile.goal, activity: state.profile.activity, after };
  scan = s;
  openSheet(scanHTML(), {
    tag: 'scan',
    cls: 'tall',
    onClose: () => { if (scan?.status === 'busy') scan.controller.abort(); scan = null; },
  });
  try {
    const r = await readScan(image, { signal: s.controller.signal });
    if (scan !== s) return;
    s.result = r;
    s.status = 'done';
    const lean = r.leanKg || (r.weightKg && r.bodyFatPct ? round(r.weightKg * (1 - r.bodyFatPct / 100), 0.1) : '');
    s.fields = { date: r.date || dayKey(), weightKg: r.weightKg || '', bodyFatPct: r.bodyFatPct || '', leanKg: lean, muscleKg: r.muscleKg || '', bmr: r.bmr || '' };
  } catch (e) {
    if (scan !== s) return;
    if (isAbort(e)) { scan = null; return; }
    s.status = 'error';
    s.error = friendlyError(e);
  }
  if (sheetTag() === 'scan') setSheet(scanHTML());
}

function scanTargets(s) {
  const f = s.fields;
  return computeTargets({
    bmr: +f.bmr, leanKg: +f.leanKg, weightKg: +f.weightKg,
    sex: s.result?.sex || state.profile.sex, age: s.result?.age || state.profile.age, heightCm: s.result?.heightCm || state.profile.heightCm,
    activity: s.activity, goal: s.goal,
  });
}

function previewHTML(s) {
  const t = scanTargets(s);
  if (!t) return '<p class="muted small">Add your BMR, or lean mass, to work out targets.</p>';
  return `<div class="target-grid">
      <div><b>${num(t.kcal)}</b><span>kcal</span></div><div><b>${num(t.protein)} g</b><span>protein</span></div>
      <div><b>${num(t.carbs)} g</b><span>carbs</span></div><div><b>${num(t.fat)} g</b><span>fat</span></div>
    </div><p class="hint">${esc(basisText(t))}</p>`;
}

function scanHTML() {
  const s = scan;
  if (!s) return '';
  const photo = `<img class="an-photo" src="${s.image.url}" alt="Your scan">`;
  if (s.status === 'busy') {
    return `<div class="an">${photo}<div class="an-busy"><span class="spinner" aria-hidden="true"></span><span role="status">Reading your scan…</span></div>
      <button class="btn ghost wide" data-act="sheet-close">Cancel</button></div>`;
  }
  if (s.status === 'error') {
    return `<div class="an">${photo}<div class="an-error" role="alert">${icon('alert')}<p>${esc(s.error)}</p></div>
      <div class="sheet-actions"><button class="btn ghost" data-act="sheet-close">Close</button></div></div>`;
  }
  const f = s.fields;
  const field = (k, label, unit, step = '0.1') => `<label class="field"><span>${label}</span><span class="num-input"><input type="number" inputmode="decimal" step="${step}" value="${f[k] === '' ? '' : f[k]}" data-bind="scan-field" data-f="${k}"><span>${unit}</span></span></label>`;
  const seg = (act, items, cur) => items.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${esc(l)}</button>`).join('');
  const act = ACTIVITY.find(a => a.v === s.activity) || ACTIVITY[1];
  return `
  <div class="sheet-head"><h3 class="sheet-title">Your scan</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
  ${s.result.summary ? `<p class="muted">${esc(s.result.summary)}</p>` : ''}
  <p class="hint">Check these against your report and fix anything Claude misread.</p>
  <div class="field-row">
    <label class="field"><span>Scan date</span><input class="input" type="date" value="${esc(f.date)}" max="${dayKey()}" data-bind="scan-field" data-f="date"></label>
    ${field('weightKg', 'Weight', 'kg')}
  </div>
  <div class="field-row">${field('bodyFatPct', 'Body fat', '%')}${field('leanKg', 'Lean mass', 'kg')}</div>
  <div class="field-row">${field('muscleKg', 'Skeletal muscle', 'kg')}${field('bmr', 'BMR', 'kcal', '1')}</div>
  ${s.result.other ? `<p class="hint">Also on the report: ${esc(s.result.other)}</p>` : ''}
  <h4 class="label">Goal</h4>
  <div class="seg sm" role="group" aria-label="Goal">${seg('scan-goal', Object.entries(GOALS).map(([k, g]) => [k, g.label]), s.goal)}</div>
  <p class="hint">${esc(GOALS[s.goal].blurb)}</p>
  <h4 class="label">Activity</h4>
  <div class="seg sm" role="group" aria-label="Activity">${seg('scan-activity', ACTIVITY.map(a => [a.v, a.label]), s.activity)}</div>
  <p class="hint">${esc(act.blurb)}</p>
  <h4 class="label">Your targets</h4>
  <div class="card pad" id="scan-preview">${previewHTML(s)}</div>
  <div class="sheet-actions">
    <button class="btn primary" data-act="scan-save" data-use="1">Save and use these targets</button>
    <button class="btn ghost" data-act="scan-save" data-use="0">Save the scan only</button>
  </div>`;
}

function saveScan(useTargets) {
  const s = scan;
  if (!s?.result) return;
  const f = s.fields;
  const rec = {
    id: uid(), date: isDayKey(f.date) ? f.date : dayKey(),
    weightKg: +f.weightKg || 0, bodyFatPct: +f.bodyFatPct || 0, leanKg: +f.leanKg || 0, muscleKg: +f.muscleKg || 0, bmr: +f.bmr || 0,
    fatMassKg: s.result.fatMassKg, visceral: s.result.visceral, other: s.result.other, summary: s.result.summary, at: Date.now(),
  };
  state.scans.push(rec);
  state.scans.sort((a, b) => a.date.localeCompare(b.date));
  if (rec.weightKg) upsertWeight(rec.date, rec.weightKg, 'scan');
  state.profile.goal = s.goal;
  state.profile.activity = s.activity;
  if (s.result.sex) state.profile.sex = s.result.sex;
  let set = false;
  if (useTargets) {
    const t = scanTargets(s);
    if (t) { state.targets = { ...t, source: 'scan', scanId: rec.id, setAt: Date.now() }; set = true; }
  }
  save();
  const after = s.after;
  scan = null;
  closeSheet();
  toast(set ? 'Scan saved and targets set' : 'Scan saved');
  if (after) after();
  else rerender();
}

function openScan(id) {
  const s = state.scans.find(x => x.id === id);
  if (!s) return;
  const row = (label, v) => (v ? `<div class="row"><span class="row-main"><span class="row-title">${label}</span></span><b>${esc(v)}</b></div>` : '');
  openSheet(`
    <div class="sheet-head"><h3 class="sheet-title">Scan, ${esc(dayShort(s.date))}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
    ${s.summary ? `<p class="muted">${esc(s.summary)}</p>` : ''}
    <div class="card list">
      ${row('Weight', s.weightKg && `${s.weightKg} kg`)}${row('Body fat', s.bodyFatPct && `${s.bodyFatPct}%`)}${row('Fat mass', s.fatMassKg && `${s.fatMassKg} kg`)}
      ${row('Lean mass', s.leanKg && `${s.leanKg} kg`)}${row('Skeletal muscle', s.muscleKg && `${s.muscleKg} kg`)}${row('BMR', s.bmr && `${num(s.bmr)} kcal`)}
      ${row('Visceral fat', s.visceral && String(s.visceral))}
    </div>
    ${s.other ? `<p class="hint">${esc(s.other)}</p>` : ''}
    <div class="sheet-actions">
      <button class="btn primary" data-act="scan-use" data-id="${s.id}">Use this scan for my targets</button>
      <button class="btn ghost danger" data-act="scan-del" data-id="${s.id}">Delete scan</button>
    </div>`, { tag: 'scan-view' });
}

// ---------- screen ----------

function scansCard() {
  if (!state.scans.length) return '';
  return `<h2 class="label">Body scans</h2>
  <div class="card list">${[...state.scans].reverse().map(s => `<button class="row" data-act="open-scan" data-id="${s.id}">
    ${icon('body')}<span class="row-main"><span class="row-title">${esc(dayTitle(s.date))}</span>
    <span class="row-sub">${[s.weightKg && `${s.weightKg} kg`, s.bodyFatPct && `${s.bodyFatPct}% body fat`, s.muscleKg && `${s.muscleKg} kg muscle`, s.bmr && `BMR ${num(s.bmr)}`].filter(Boolean).join(' · ')}</span></span>
    ${icon('chev', 'end')}</button>`).join('')}</div>`;
}

function view() {
  return `
  <header class="top"><h1>Body</h1></header>
  ${targetsCard()}
  ${adaptiveCard()}
  ${weightCard()}
  ${scansCard()}`;
}

function mount() {
  const svg = document.querySelector('.weight-chart');
  if (!svg) return;
  const ws = weightSeries();
  bindTips(svg, {
    text: date => { const w = ws.find(x => x.date === date); return w ? `${dayTitle(w.date)}: ${w.kg.toFixed(1)} kg${w.source === 'garmin' ? ' (Garmin)' : w.source === 'scan' ? ' (scan)' : ''}` : ''; },
  });
}

export const actions = {
  'edit-targets': openTargets,
  't-balance': () => { editT = balanceCarbs({ ...editT, kcal: +editT.kcal || 0, protein: +editT.protein || 0, fat: +editT.fat || 0 }); refreshTargets(); },
  't-goal': el => { calc.goal = el.dataset.v; refreshTargets(); },
  't-activity': el => { calc.activity = +el.dataset.v; refreshTargets(); },
  't-sex': el => { calc.sex = el.dataset.v; refreshTargets(); },
  't-calc': el => {
    const latest = state.scans[state.scans.length - 1];
    const t = el.dataset.from === 'scan' && latest
      ? computeTargets({ bmr: latest.bmr, leanKg: latest.leanKg, weightKg: latest.weightKg, sex: state.profile.sex, age: state.profile.age, heightCm: state.profile.heightCm, activity: calc.activity, goal: calc.goal })
      : computeTargets({ weightKg: +calc.weightKg, heightCm: +calc.heightCm, age: +calc.age, sex: calc.sex, activity: calc.activity, goal: calc.goal });
    if (!t) { toast(el.dataset.from === 'scan' ? 'That scan has no BMR or lean mass.' : 'Add your age, height and weight.'); return; }
    editT = { ...t, source: el.dataset.from };
    refreshTargets();
    toast('Calculated. Check them, then save.');
  },
  't-save': () => {
    const t = { kcal: Math.round(+editT.kcal), protein: Math.round(+editT.protein), carbs: Math.round(+editT.carbs), fat: Math.round(+editT.fat) };
    if (!(t.kcal >= 800 && t.kcal <= 6000)) { toast('Calories should be between 800 and 6,000.'); return; }
    if ([t.protein, t.carbs, t.fat].some(v => !(v >= 0))) { toast('Fill in protein, carbs and fat.'); return; }
    const same = editT.basis && state.targets && editT.basis === state.targets.basis;
    state.targets = { ...t, basis: editT.basis || null, source: editT.source || (same ? state.targets.source : 'manual'), setAt: Date.now() };
    state.profile.goal = calc.goal;
    state.profile.activity = calc.activity;
    if (calc.sex) state.profile.sex = calc.sex;
    if (+calc.age) state.profile.age = +calc.age;
    if (+calc.heightCm) state.profile.heightCm = +calc.heightCm;
    save();
    closeSheet();
    rerender();
    toast('Targets saved');
  },
  'scan-goal': el => { if (!scan) return; scan.goal = el.dataset.v; setSheet(scanHTML()); },
  'scan-activity': el => { if (!scan) return; scan.activity = +el.dataset.v; setSheet(scanHTML()); },
  'scan-save': el => saveScan(el.dataset.use === '1'),
  'open-scan': el => openScan(el.dataset.id),
  'scan-use': el => {
    const s = state.scans.find(x => x.id === el.dataset.id);
    const t = s && computeTargets({ bmr: s.bmr, leanKg: s.leanKg, weightKg: s.weightKg, sex: state.profile.sex, age: state.profile.age, heightCm: state.profile.heightCm, activity: state.profile.activity, goal: state.profile.goal });
    if (!t) { toast('That scan has no BMR or lean mass.'); return; }
    state.targets = { ...t, source: 'scan', scanId: s.id, setAt: Date.now() };
    save();
    closeSheet();
    rerender();
    toast('Targets updated from that scan');
  },
  'scan-del': async el => {
    const id = el.dataset.id;
    if (!(await confirmSheet({ title: 'Delete this scan?', body: 'Your targets stay as they are.', ok: 'Delete', danger: true }))) return;
    const s = state.scans.find(x => x.id === id);
    state.scans = state.scans.filter(x => x.id !== id);
    if (s) state.weights = state.weights.filter(w => !(w.source === 'scan' && w.date === s.date));
    save();
    rerender();
  },
  'use-adaptive': el => {
    const t = state.targets;
    if (!t) return;
    state.targets = { ...balanceCarbs({ ...t, kcal: +el.dataset.v }), basis: { ...(t.basis || {}), maintenance: +el.dataset.m, adaptive: true }, setAt: Date.now() };
    save();
    rerender();
    toast(`Calories set to ${num(+el.dataset.v)}`);
  },
  'log-weight': openWeight,
  'w-save': () => {
    const kg = Math.round(parseFloat(document.getElementById('w-kg')?.value) * 10) / 10;
    const date = document.getElementById('w-date')?.value;
    if (!(kg > 20 && kg < 400)) { toast('Enter your weight in kilograms.'); return; }
    upsertWeight(isDayKey(date) && date <= dayKey() ? date : dayKey(), kg, 'manual');
    save();
    closeSheet();
    rerender();
    toast(`Saved ${kg.toFixed(1)} kg`);
  },
  'w-del': el => {
    state.weights = state.weights.filter(w => !(w.source === 'manual' && w.date === el.dataset.date));
    save();
    openWeight();
    rerender();
  },
};

export const binds = {
  'scan-in': el => {
    const file = el.files?.[0];
    el.value = '';
    if (file) startScan(file);
  },
  'scan-field': el => {
    if (!scan?.fields) return;
    scan.fields[el.dataset.f] = el.value;
    const box = document.getElementById('scan-preview');
    if (box) box.innerHTML = previewHTML(scan);
  },
  't-field': el => {
    editT[el.dataset.f] = el.value;
    editT.basis = null; // hand-edited numbers no longer follow the formula
    const check = document.getElementById('t-check');
    if (check) check.textContent = macroCheck();
  },
  'c-field': el => { calc[el.dataset.f] = el.value; },
};

export const routes = {
  body: { html: view, mount, tab: 'body' },
};
