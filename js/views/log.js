// Logging: the composer, Claude's confirm card (nothing is logged until you say so),
// quick add, manual entry and the sheet for an entry that's already logged.
import { state, save, day } from '../store.js';
import { dayTotals, entryTotals, itemsTotal, targetFor, kcalStatus, addTo, zero, rounded } from '../nutrition.js';
import { esc, num, uid, dayKey, dayTitle, addDays, MEALS, mealFor, stampFor, timeText } from '../util.js';
import { icon, openSheet, setSheet, sheetTag, closeSheet, toast, rerender, go, macroLine } from '../ui.js';
import { prepareImage, putThumb, hydrateThumbs } from '../photos.js';
import { analyzeFood, friendlyError, isAbort, hasKey, modelLabel, modelFor } from '../ai.js';

const PORTIONS = [[0.5, '½'], [0.75, '¾'], [1, '1×'], [1.5, '1½'], [2, '2×']];

let job = null;          // the analysis on screen
let statusTimer = null;
let composeKey = dayKey();
let composeImage = null;
let entryCtx = null;     // { key, id } of the entry sheet
let manualCtx = null;    // { key, entryId, meal } of the manual form

const mealSeg = (act, current, extra = '') => MEALS.map(([m, l]) => `<button class="${current === m ? 'on' : ''}" data-act="${act}" data-v="${m}" ${extra} aria-pressed="${current === m}">${l}</button>`).join('');

function loggedText(key) {
  const target = targetFor(key);
  if (!target) return 'Logged';
  const left = target.kcal - dayTotals(key).kcal;
  return left >= 0 ? `Logged · ${num(left)} kcal left` : `Logged · ${num(-left)} kcal over`;
}

function scaledItems(e) {
  if (e.override) return [{ name: e.title, portion: '', ...e.override }];
  const k = e.scale || 1;
  return (e.items || []).map(it => ({ ...it, kcal: Math.round(it.kcal * k), protein: Math.round(it.protein * k), carbs: Math.round(it.carbs * k), fat: Math.round(it.fat * k) }));
}

const isFavorite = title => state.favorites.some(f => f.title.toLowerCase() === String(title).toLowerCase());

function addEntry(key, entry) {
  const d = day(key, true);
  d.entries.push(entry);
  d.recap = null;
  save();
  return entry;
}

function undoLog(key, ids, before) {
  const d = day(key, true);
  if (before) {
    const i = d.entries.findIndex(e => e.id === before.id);
    if (i >= 0) d.entries[i] = before;
    d.entries = d.entries.filter(e => e.id === before.id || !ids.includes(e.id));
  } else {
    d.entries = d.entries.filter(e => !ids.includes(e.id));
  }
  save();
  rerender();
}

// ---------- composer ----------

function quickList() {
  const favs = state.favorites.slice(-6).reverse();
  const skip = new Set(favs.map(f => f.title.toLowerCase()));
  const recents = [];
  for (let i = 0; i < 30 && recents.length < 6; i++) {
    const k = addDays(dayKey(), -i);
    for (const e of [...day(k).entries].sort((a, b) => b.at - a.at)) {
      const t = e.title.toLowerCase();
      if (skip.has(t)) continue;
      skip.add(t);
      recents.push([k, e]);
      if (recents.length >= 6) break;
    }
  }
  const row = (attrs, title, t, fav) => `<button class="row quick" data-act="quick-add" ${attrs}>
    ${icon(fav ? 'star' : 'refresh', fav ? 'fill fav' : '')}
    <span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${num(t.kcal)} kcal · ${macroLine(t)}</span></span>
    ${icon('plus', 'end')}</button>`;
  return [
    ...favs.map(f => row(`data-src="fav" data-id="${esc(f.id)}"`, f.title, itemsTotal(f.items), true)),
    ...recents.map(([k, e]) => row(`data-src="recent" data-day="${k}" data-id="${esc(e.id)}"`, e.title, entryTotals(e), false)),
  ].join('');
}

const attachHTML = () => (composeImage ? `<span class="attach-chip"><img src="${composeImage.url}" alt="Attached photo">
  <button class="attach-x" data-act="compose-unattach" aria-label="Remove photo">${icon('close')}</button></span>` : '');

function composeHTML(text) {
  const key = composeKey;
  const today = key === dayKey();
  const quick = quickList();
  return `
  <div class="sheet-head"><h3 class="sheet-title">${today ? 'Log food' : `Add to ${esc(dayTitle(key))}`}</h3>
    <button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
  <textarea id="compose-text" class="input compose-text" rows="3" placeholder="e.g. 2 eggs on sourdough and a flat white. Or ask: should I have a croissant?">${esc(text)}</textarea>
  <div class="compose-row">
    <label class="pill">${icon('camera')}<span>Camera</span><input type="file" accept="image/*" capture="environment" class="visually-hidden" data-bind="compose-photo"></label>
    <label class="pill">${icon('image')}<span>Photo</span><input type="file" accept="image/*" class="visually-hidden" data-bind="compose-photo"></label>
    <span id="compose-attach" class="attach">${attachHTML()}</span>
    <button class="send-btn" data-act="compose-send" aria-label="Analyze">${icon('send')}</button>
  </div>
  ${today ? `<div class="chips quick-asks">
    <button class="chip" data-act="ask" data-q="What should I eat next?">What should I eat next?</button>
    <button class="chip" data-act="ask" data-q="How am I doing today?">How am I doing?</button>
  </div>` : ''}
  ${quick ? `<h4 class="label">Quick add</h4><div class="card list">${quick}</div>` : ''}
  <button class="link-row" data-act="manual-new">${icon('edit')}Enter the numbers myself</button>`;
}

export function openCompose(key = dayKey(), text = '') {
  composeKey = key;
  composeImage = null;
  openSheet(composeHTML(text), { tag: 'compose' });
  const ta = document.getElementById('compose-text');
  ta?.focus(); // inside the tap, so iOS opens the keyboard
}

async function attachPhoto(file) {
  try {
    composeImage = await prepareImage(file);
  } catch (e) {
    toast(e.message);
    return;
  }
  const slot = document.getElementById('compose-attach');
  if (slot) slot.innerHTML = attachHTML();
}

function sendCompose() {
  const ta = document.getElementById('compose-text');
  const text = (ta?.value || '').trim();
  if (!text && !composeImage) {
    toast('Type what you had, or add a photo.');
    ta?.focus();
    return;
  }
  const image = composeImage;
  composeImage = null;
  startAnalysis({ key: composeKey, text, image });
}

export async function startPhoto(file, key) {
  let image;
  try {
    image = await prepareImage(file);
  } catch (e) {
    toast(e.message);
    return;
  }
  startAnalysis({ key, text: '', image });
}

function quickAdd(el) {
  const key = composeKey;
  const src = el.dataset.src === 'fav'
    ? state.favorites.find(f => f.id === el.dataset.id)
    : day(el.dataset.day).entries.find(e => e.id === el.dataset.id);
  if (!src) return;
  const at = stampFor(key);
  const entry = addEntry(key, {
    id: uid(), at, meal: mealFor(new Date(at)), title: src.title,
    items: el.dataset.src === 'fav' ? src.items : scaledItems(src),
    scale: 1, override: null, source: 'quick', confidence: src.confidence || null,
    note: src.note || '', lookup: src.lookup || '', photoId: src.photoId || null, text: '',
  });
  closeSheet();
  rerender();
  toast(loggedText(key), { action: 'Undo', onAction: () => undoLog(key, [entry.id], null) });
}

// ---------- the analysis ----------

function statusText(j) {
  const s = (Date.now() - j.started) / 1000;
  if (j.phase === 'search') return 'Checking the official nutrition info…';
  if (j.phase === 'record') return 'Writing it up…';
  if (s < 5) return j.refine ? 'Applying your correction…' : j.image ? 'Looking at your photo…' : 'Reading what you had…';
  if (s < 12) return 'Estimating portions…';
  if (s < 22) return 'Checking it against your day…';
  return `Still working. ${modelLabel(modelFor(j.image ? 'photo' : 'text'))} is being thorough…`;
}

function paintStatus() {
  const el = document.getElementById('an-status');
  if (el && job) el.textContent = statusText(job);
}

async function startAnalysis({ key, text = '', image = null, refine = null }) {
  if (!hasKey()) {
    closeSheet();
    toast('Add your Anthropic API key first.');
    go('#/settings');
    return;
  }
  if (job?.status === 'busy') job.controller.abort();
  const j = {
    id: uid(), key, text, image, refine, status: 'busy', phase: '', started: Date.now(),
    controller: new AbortController(), titles: [], scales: [], meals: [], refineDraft: '',
  };
  job = j;
  showJob();
  try {
    const r = await analyzeFood({
      text, image, key, refine, signal: j.controller.signal,
      onStatus: p => { if (job === j) { j.phase = p; paintStatus(); } },
    });
    if (job !== j) return;
    const fallback = mealFor(new Date(stampFor(key)));
    j.result = r;
    j.status = 'done';
    j.titles = r.entries.map(e => e.title);
    j.scales = r.entries.map(() => 1);
    j.meals = r.entries.map(e => (refine?.meal && r.entries.length === 1 ? refine.meal : e.meal || fallback));
  } catch (e) {
    if (job !== j) return;
    if (isAbort(e)) { job = null; return; }
    j.status = 'error';
    j.error = friendlyError(e);
  }
  showJob();
}

function showJob() {
  const j = job;
  if (!j) return;
  clearInterval(statusTimer);
  const html = jobHTML(j);
  if (sheetTag() === 'job') setSheet(html);
  else {
    openSheet(html, {
      tag: 'job',
      cls: 'tall',
      onClose: () => {
        clearInterval(statusTimer);
        if (job?.status === 'busy') job.controller.abort();
        job = null;
      },
    });
  }
  if (j.status === 'busy') statusTimer = setInterval(paintStatus, 1000);
}

function jobTotals(j) {
  return rounded(j.result.entries.reduce((t, e, i) => addTo(t, itemsTotal(e.items, j.scales[i] || 1)), zero()));
}

function jobHTML(j) {
  const preview = j.image
    ? `<img class="an-photo" src="${j.image.url}" alt="Your photo">`
    : j.text ? `<p class="an-quote">“${esc(j.text)}”</p>` : '';
  if (j.status === 'busy') {
    return `<div class="an">${preview}
      <div class="an-busy"><span class="spinner" aria-hidden="true"></span><span id="an-status" role="status" aria-live="polite">${esc(statusText(j))}</span></div>
      <button class="btn ghost wide" data-act="an-cancel">Cancel</button></div>`;
  }
  if (j.status === 'error') {
    return `<div class="an">${preview}
      <div class="an-error" role="alert">${icon('alert')}<p>${esc(j.error)}</p></div>
      <div class="sheet-actions"><button class="btn primary" data-act="an-retry">Try again</button>
      <button class="btn ghost" data-act="sheet-close">Close</button></div></div>`;
  }
  return resultHTML(j);
}

function verdictHTML(intent, after, target) {
  if (!target) {
    return `<div class="verdict v-none">${icon('info')}<div><b>No targets yet</b><span>Set them in the Body tab to see what's left.</span></div></div>`;
  }
  const left = target.kcal - after.kcal;
  const st = kcalStatus(after.kcal, target.kcal);
  const check = intent === 'check';
  let head;
  if (st === 'over') head = check ? `You'd be ${num(-left)} kcal over` : `${num(-left)} kcal over after this`;
  else if (st === 'tight') head = check ? `Tight: you'd have ${num(left)} kcal left` : `Tight: ${num(left)} kcal left after this`;
  else head = check ? `Fits: you'd have ${num(left)} kcal left` : `${num(left)} kcal left after this`;
  const g = (k, label) => { const l = target[k] - after[k]; return l >= 0 ? `${label} ${num(l)} g left` : `${label} ${num(-l)} g over`; };
  const p = target.protein - after.protein;
  const sub = [p > 0 ? `Protein ${num(p)} g to go` : 'Protein goal hit', g('carbs', 'carbs'), g('fat', 'fat')].join(' · ');
  return `<div class="verdict v-${st}" role="status">${icon(st === 'fits' ? 'checkCircle' : 'alert')}<div><b>${head}</b><span>${sub}</span></div></div>`;
}

function entryCard(j, e, i) {
  const k = j.scales[i] || 1;
  const t = itemsTotal(e.items, k);
  return `<section class="an-entry">
    <div class="an-entry-head">
      <input class="an-title" value="${esc(j.titles[i] ?? e.title)}" data-bind="an-title" data-i="${i}" aria-label="Name of this entry">
      <b class="an-kcal">${num(t.kcal)}<small> kcal</small></b>
    </div>
    <div class="an-macro">${macroLine(t)}</div>
    <ul class="an-items">${e.items.map(it => `<li><span class="an-item-name">${esc(it.name)}${it.portion ? `<small>${esc(it.portion)}</small>` : ''}</span><span class="an-item-kcal">${num(it.kcal * k)}</span></li>`).join('')}</ul>
    <div class="seg xs" role="group" aria-label="Meal">${mealSeg('an-meal', j.meals[i], `data-i="${i}"`)}</div>
    <div class="portion" role="group" aria-label="How much you had">${PORTIONS.map(([v, l]) => `<button class="${k === v ? 'on' : ''}" data-act="an-scale" data-i="${i}" data-v="${v}" aria-pressed="${k === v}">${l}</button>`).join('')}</div>
  </section>`;
}

function altsHTML(r, advice) {
  if (!r.alternatives.length) return '';
  const button = advice ? 'Log it' : r.intent === 'check' ? 'Have this' : '';
  return `<h4 class="label">${advice ? 'Ideas that fit' : r.intent === 'check' ? 'Better options' : 'Next time'}</h4>
  <div class="card list alts">${r.alternatives.map((a, i) => `<div class="row alt">
    <span class="row-main"><span class="row-title">${esc(a.name)}</span>${a.why ? `<span class="row-sub">${esc(a.why)}</span>` : ''}<span class="row-sub">${num(a.kcal)} kcal · ${macroLine(a)}</span></span>
    ${button ? `<button class="mini" data-act="an-alt" data-i="${i}">${button}</button>` : ''}</div>`).join('')}</div>`;
}

function actionsHTML(j, r, add, advice) {
  if (advice) return '<button class="btn primary" data-act="sheet-close">Done</button>';
  if (j.refine?.entryId) {
    return `<button class="btn primary" data-act="an-log">Save changes · ${num(add.kcal)} kcal</button>
      <button class="btn ghost" data-act="sheet-close">Keep the old numbers</button>`;
  }
  if (r.intent === 'check') {
    return `<button class="btn primary" data-act="an-log">I'm having it · log ${num(add.kcal)} kcal</button>
      <button class="btn ghost" data-act="an-skip">Skip it</button>`;
  }
  return `<button class="btn primary" data-act="an-log">Log it · ${num(add.kcal)} kcal</button>
    <button class="btn ghost" data-act="an-skip">Don't log</button>`;
}

function resultHTML(j) {
  const r = j.result;
  const advice = r.intent === 'advice' || !r.entries.length;
  const add = advice ? zero() : jobTotals(j);
  const after = addTo(dayTotals(j.key, { exclude: j.refine?.entryId }), add);
  const target = targetFor(j.key);
  const conf = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }[r.confidence];
  const tags = `${advice ? '' : `<span class="tag conf-${r.confidence}">${conf}</span>`}${r.searched ? `<span class="tag">${icon('search', 'inline')} Checked online</span>` : ''}`;
  return `<div class="an">
    ${j.image || r.what_i_see || tags ? `<div class="an-top">
      ${j.image ? `<img class="an-thumb" src="${j.image.url}" alt="">` : ''}
      <div class="an-top-text">${r.what_i_see ? `<p class="an-see">${esc(r.what_i_see)}</p>` : ''}${tags ? `<div class="tags">${tags}</div>` : ''}</div>
    </div>` : ''}
    ${advice ? '' : verdictHTML(r.intent, after, target)}
    ${r.coach ? `<p class="coach">${esc(r.coach)}</p>` : ''}
    ${r.clarify ? `<button class="clarify" data-act="an-clarify">${icon('info')}<span>${esc(r.clarify)}</span><b>Answer</b></button>` : ''}
    ${r.entries.map((e, i) => entryCard(j, e, i)).join('')}
    ${r.source_note ? `<p class="src">${icon('info', 'inline')} ${esc(r.source_note)}</p>` : ''}
    ${altsHTML(r, advice)}
    ${advice ? '' : `<div class="refine"><input id="refine-text" class="input" placeholder="Something off? Tell Claude…" value="${esc(j.refineDraft)}" data-bind="an-refine-draft" data-enter="an-refine" enterkeyhint="send" autocomplete="off"><button class="btn secondary sm" data-act="an-refine">Fix</button></div>`}
    <div class="an-actions">${actionsHTML(j, r, add, advice)}</div>
  </div>`;
}

function logJob() {
  const j = job;
  if (!j?.result?.entries.length) return;
  const d = day(j.key, true);
  const replacing = j.refine?.entryId ? d.entries.find(e => e.id === j.refine.entryId) : null;
  const before = replacing ? { ...replacing } : null;
  const photoId = replacing?.photoId || (j.image ? uid() : null);
  const ids = [];
  j.result.entries.forEach((e, i) => {
    const entry = {
      id: i === 0 && replacing ? replacing.id : uid(),
      at: replacing?.at || stampFor(j.key),
      meal: j.meals[i],
      title: String(j.titles[i] ?? e.title).trim() || 'Food',
      items: e.items,
      scale: j.scales[i] || 1,
      override: null,
      source: replacing?.source || (j.image ? 'photo' : 'text'),
      confidence: j.result.confidence,
      note: j.result.what_i_see,
      lookup: j.result.source_note,
      photoId,
      text: replacing?.text ?? j.text,
    };
    if (i === 0 && replacing) d.entries[d.entries.indexOf(replacing)] = entry;
    else d.entries.push(entry);
    ids.push(entry.id);
  });
  if (j.image && !replacing?.photoId) putThumb(photoId, j.image.thumb);
  d.recap = null;
  save();
  const key = j.key;
  job = null;
  closeSheet();
  rerender();
  toast(replacing ? 'Updated' : loggedText(key), { action: 'Undo', onAction: () => undoLog(key, ids, before) });
}

function logAlt(i) {
  const j = job;
  const a = j?.result?.alternatives[i];
  if (!a) return;
  const at = stampFor(j.key);
  const entry = addEntry(j.key, {
    id: uid(), at, meal: j.meals[0] || mealFor(new Date(at)), title: a.name,
    items: [{ name: a.name, portion: '', kcal: a.kcal, protein: a.protein, carbs: a.carbs, fat: a.fat }],
    scale: 1, override: null, source: 'text', confidence: 'medium', note: a.why, lookup: '', photoId: null, text: '',
  });
  const key = j.key;
  job = null;
  closeSheet();
  rerender();
  toast(loggedText(key), { action: 'Undo', onAction: () => undoLog(key, [entry.id], null) });
}

function refineJob() {
  const j = job;
  if (!j?.result) return;
  const el = document.getElementById('refine-text');
  const text = (el?.value || '').trim();
  if (!text) { el?.focus(); return; }
  startAnalysis({ key: j.key, text, image: j.image, refine: { ...(j.refine || {}), previous: j.result, originalText: j.refine?.originalText ?? j.text } });
}

// ---------- an entry that's already logged ----------

const findEntry = () => (entryCtx ? day(entryCtx.key).entries.find(e => e.id === entryCtx.id) || null : null);

function entryHTML() {
  const e = findEntry();
  if (!e) return '';
  const t = entryTotals(e);
  const fav = isFavorite(e.title);
  const k = e.scale || 1;
  return `
  <div class="sheet-head"><h3 class="sheet-title">${esc(e.title)}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
  ${e.photoId ? `<img class="entry-photo" data-thumb="${esc(e.photoId)}" alt="">` : ''}
  <div class="entry-sum"><b>${num(t.kcal)} kcal</b>${macroLine(t)}</div>
  <div class="seg xs" role="group" aria-label="Meal">${mealSeg('entry-meal', e.meal)}</div>
  ${e.override
    ? '<p class="hint">You set these numbers yourself. <button class="linklike" data-act="entry-unoverride">Go back to Claude\'s estimate</button></p>'
    : `<div class="portion" role="group" aria-label="How much you had">${PORTIONS.map(([v, l]) => `<button class="${k === v ? 'on' : ''}" data-act="entry-scale" data-v="${v}" aria-pressed="${k === v}">${l}</button>`).join('')}</div>`}
  ${e.items?.length > 1 || e.items?.[0]?.portion ? `<details class="more"><summary>What's in it</summary>
    <ul class="an-items">${e.items.map(it => `<li><span class="an-item-name">${esc(it.name)}${it.portion ? `<small>${esc(it.portion)}</small>` : ''}</span><span class="an-item-kcal">${num(it.kcal * k)}</span></li>`).join('')}</ul></details>` : ''}
  ${e.note ? `<p class="hint">${esc(e.note)}</p>` : ''}
  ${e.lookup ? `<p class="src">${icon('info', 'inline')} ${esc(e.lookup)}</p>` : ''}
  <div class="refine"><input id="entry-fix-text" class="input" placeholder="Something off? Tell Claude…" data-enter="entry-fix" enterkeyhint="send" autocomplete="off"><button class="btn secondary sm" data-act="entry-fix">Fix</button></div>
  <div class="card list">
    <button class="row" data-act="entry-edit">${icon('edit')}<span class="row-main"><span class="row-title">Edit the name or numbers</span></span></button>
    <button class="row" data-act="entry-fav">${icon('star', fav ? 'fill fav' : '')}<span class="row-main"><span class="row-title">${fav ? 'Remove from favorites' : 'Save as a favorite'}</span><span class="row-sub">Favorites are one tap away when you log</span></span></button>
    <button class="row" data-act="entry-again">${icon('plus')}<span class="row-main"><span class="row-title">Log again today</span></span></button>
    <button class="row danger" data-act="entry-delete">${icon('trash')}<span class="row-main"><span class="row-title">Delete</span></span></button>
  </div>
  <p class="hint">Logged ${timeText(e.at)}${e.source === 'photo' ? ' from a photo' : e.source === 'manual' ? ' by hand' : ''}${e.confidence ? ` · ${e.confidence} confidence` : ''}</p>`;
}

export function openEntry(key, id) {
  entryCtx = { key, id };
  const html = entryHTML();
  if (!html) return;
  openSheet(html, { tag: 'entry' });
  hydrateThumbs(document.getElementById('sheet'));
}

function refreshEntry() {
  const html = entryHTML();
  if (html) {
    setSheet(html);
    hydrateThumbs(document.getElementById('sheet'));
  } else {
    closeSheet();
  }
  rerender();
}

function changeEntry(fn) {
  const e = findEntry();
  if (!e) return;
  fn(e);
  day(entryCtx.key, true).recap = null;
  save();
  refreshEntry();
}

function entryAsRecord(e) {
  return { intent: 'log', what_i_see: e.note || '', entries: [{ title: e.title, meal: e.meal, items: scaledItems(e) }] };
}

// ---------- manual entry ----------

export function openManual(key, entryId = null) {
  const e = entryId ? day(key).entries.find(x => x.id === entryId) : null;
  const t = e ? entryTotals(e) : null;
  manualCtx = { key, entryId, meal: e?.meal || mealFor(new Date(stampFor(key))) };
  const f = (id, label, val, unit) => `<label class="field"><span>${label}</span><span class="num-input"><input id="${id}" type="number" inputmode="decimal" min="0" step="1" value="${val ?? ''}" placeholder="0"><span>${unit}</span></span></label>`;
  openSheet(`
    <div class="sheet-head"><h3 class="sheet-title">${e ? 'Edit the numbers' : 'Enter it yourself'}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
    <label class="field"><span>Name</span><input id="m-title" class="input" value="${esc(e?.title || '')}" placeholder="e.g. Protein shake" autocomplete="off"></label>
    <div class="field-row">${f('m-kcal', 'Calories', t?.kcal, 'kcal')}${f('m-protein', 'Protein', t?.protein, 'g')}</div>
    <div class="field-row">${f('m-carbs', 'Carbs', t?.carbs, 'g')}${f('m-fat', 'Fat', t?.fat, 'g')}</div>
    <p class="hint">Leave calories empty and Plate works them out from the macros.</p>
    <div class="seg xs" id="m-meals" role="group" aria-label="Meal">${mealSeg('m-meal', manualCtx.meal)}</div>
    <div class="sheet-actions"><button class="btn primary" data-act="m-save">Save</button></div>`, { tag: 'manual' });
  document.getElementById(e ? 'm-kcal' : 'm-title')?.focus();
}

function saveManual() {
  const v = id => { const x = parseFloat(document.getElementById(id)?.value); return Number.isFinite(x) && x >= 0 ? x : null; };
  const title = (document.getElementById('m-title')?.value || '').trim();
  const protein = v('m-protein') ?? 0;
  const carbs = v('m-carbs') ?? 0;
  const fat = v('m-fat') ?? 0;
  const kcal = v('m-kcal') ?? protein * 4 + carbs * 4 + fat * 9;
  if (!kcal) { toast('Add the calories, or the macros.'); return; }
  const totals = { kcal: Math.round(kcal), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
  const { key, entryId, meal } = manualCtx;
  const d = day(key, true);
  if (entryId) {
    const e = d.entries.find(x => x.id === entryId);
    if (e) {
      const cur = entryTotals(e);
      const changed = ['kcal', 'protein', 'carbs', 'fat'].some(n => cur[n] !== totals[n]);
      e.title = title || e.title;
      e.meal = meal;
      if (changed) e.override = totals;
    }
    d.recap = null;
    save();
    closeSheet();
    rerender();
    toast('Saved');
    return;
  }
  const entry = addEntry(key, {
    id: uid(), at: stampFor(key), meal, title: title || 'Food',
    items: [{ name: title || 'Food', portion: '', ...totals }],
    scale: 1, override: null, source: 'manual', confidence: null, note: '', lookup: '', photoId: null, text: '',
  });
  closeSheet();
  rerender();
  toast(loggedText(key), { action: 'Undo', onAction: () => undoLog(key, [entry.id], null) });
}

// ---------- wiring ----------

export const actions = {
  compose: el => openCompose(el.dataset.key || dayKey()),
  'compose-send': sendCompose,
  'compose-unattach': () => {
    composeImage = null;
    const slot = document.getElementById('compose-attach');
    if (slot) slot.innerHTML = '';
  },
  ask: el => startAnalysis({ key: composeKey, text: el.dataset.q }),
  'quick-add': quickAdd,
  'manual-new': () => openManual(composeKey),
  'm-meal': el => {
    manualCtx.meal = el.dataset.v;
    for (const b of document.querySelectorAll('#m-meals button')) {
      const on = b.dataset.v === el.dataset.v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    }
  },
  'm-save': saveManual,

  'an-cancel': () => {
    job?.controller.abort();
    job = null;
    closeSheet();
  },
  'an-retry': () => { const j = job; if (j) startAnalysis({ key: j.key, text: j.text, image: j.image, refine: j.refine }); },
  'an-scale': el => { if (!job?.result) return; job.scales[+el.dataset.i] = +el.dataset.v; showJob(); },
  'an-meal': el => { if (!job?.result) return; job.meals[+el.dataset.i] = el.dataset.v; showJob(); },
  'an-log': logJob,
  'an-skip': () => {
    const check = job?.result?.intent === 'check';
    job = null;
    closeSheet();
    if (check) toast('Skipped. Good call.');
  },
  'an-alt': el => logAlt(+el.dataset.i),
  'an-refine': refineJob,
  'an-clarify': () => {
    const el = document.getElementById('refine-text');
    if (!el) return;
    el.placeholder = 'Your answer…';
    el.focus();
  },

  'entry-meal': el => changeEntry(e => { e.meal = el.dataset.v; }),
  'entry-scale': el => changeEntry(e => { e.scale = +el.dataset.v; }),
  'entry-unoverride': () => changeEntry(e => { e.override = null; }),
  'entry-fix': () => {
    const e = findEntry();
    const text = (document.getElementById('entry-fix-text')?.value || '').trim();
    if (!e) return;
    if (!text) { document.getElementById('entry-fix-text')?.focus(); return; }
    startAnalysis({ key: entryCtx.key, text, image: null, refine: { previous: entryAsRecord(e), originalText: e.text || '', entryId: e.id, meal: e.meal } });
  },
  'entry-edit': () => { if (entryCtx) openManual(entryCtx.key, entryCtx.id); },
  'entry-fav': () => {
    const e = findEntry();
    if (!e) return;
    if (isFavorite(e.title)) {
      state.favorites = state.favorites.filter(f => f.title.toLowerCase() !== e.title.toLowerCase());
      toast('Removed from favorites');
    } else {
      state.favorites.push({ id: uid(), title: e.title, items: scaledItems(e) });
      toast('Saved as a favorite');
    }
    save();
    refreshEntry();
  },
  'entry-again': () => {
    const e = findEntry();
    if (!e) return;
    const copy = addEntry(dayKey(), { ...e, id: uid(), at: Date.now(), meal: mealFor(), items: scaledItems(e), scale: 1, override: null, source: 'quick' });
    closeSheet();
    rerender();
    toast(loggedText(dayKey()), { action: 'Undo', onAction: () => undoLog(dayKey(), [copy.id], null) });
  },
  'entry-delete': () => {
    const e = findEntry();
    if (!e) return;
    const key = entryCtx.key;
    const d = day(key, true);
    const index = d.entries.indexOf(e);
    d.entries.splice(index, 1);
    d.recap = null;
    save();
    closeSheet();
    rerender();
    toast(`Deleted ${e.title}`, {
      action: 'Undo',
      onAction: () => { day(key, true).entries.splice(index, 0, e); save(); rerender(); },
    });
  },
};

export const binds = {
  'compose-photo': el => {
    const file = el.files?.[0];
    el.value = '';
    if (file) attachPhoto(file);
  },
  'an-title': el => { if (job) job.titles[+el.dataset.i] = el.value; },
  'an-refine-draft': el => { if (job) job.refineDraft = el.value; },
};
