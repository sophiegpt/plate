// Settings: Claude, Garmin, the coach, spending, backups and how Plate works.
import { state, save, getApiKey, setApiKey, getRelay, setRelay, backupJSON, parseBackup, replaceState, resetState, APP_VERSION } from '../store.js';
import { esc, ago, monthKey, randomPasscode } from '../util.js';
import { icon, rerender, go, toast, confirmSheet, openSheet, closeSheet, standalone, copyText } from '../ui.js';
import { MODELS, EFFORTS, testConnection, friendlyError, spend, MOCK } from '../ai.js';
import { testRelay, syncGarmin, garminConnected } from '../garmin.js';
import { clearThumbs } from '../photos.js';
import { ABOUT_HTML } from './about.js';

const seg = (act, items, cur) => `<div class="seg sm" role="group">${items.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${esc(l)}</button>`).join('')}</div>`;

const switchRow = (key, title, sub) => `<label class="row"><span class="row-main"><span class="row-title">${title}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>
  <input type="checkbox" class="switch" data-bind="setting" data-key="${key}" ${state.settings[key] ? 'checked' : ''}></label>`;

const MODEL_ITEMS = Object.entries(MODELS).map(([id, x]) => [id, x.short]);
const modelLine = id => (MODELS[id] ? `${MODELS[id].label}. ${MODELS[id].blurb}.` : '');

const EFFORT_HINT = {
  low: 'Quickest answers.',
  medium: 'A good balance of speed and care.',
  high: 'Slowest and most careful, and costs a little more.',
};

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
}

function settingsView() {
  const s = state.settings;
  const key = getApiKey();
  const m = spend();
  const prev = spend(lastMonth());
  const g = state.garmin;
  return `
  <header class="top"><h1>Settings</h1></header>

  <h2 class="label">Claude</h2>
  <div class="card list">
    <button class="row" data-act="open-key">${icon('key')}<span class="row-main"><span class="row-title">Anthropic API key</span>
      <span class="row-sub">${key ? `Saved on this phone · ends in ${esc(key.slice(-4))}` : MOCK ? 'Test mode: not needed' : 'Not set yet: needed to analyze food'}</span></span>${icon('chev', 'end')}</button>
    <div class="row stack"><span class="row-title">Typed entries</span>${seg('set-quick', MODEL_ITEMS, s.quickModel)}<span class="row-sub">${esc(modelLine(s.quickModel))}</span></div>
    <div class="row stack"><span class="row-title">Photos, scans and recaps</span>${seg('set-main', MODEL_ITEMS, s.mainModel)}<span class="row-sub">${esc(modelLine(s.mainModel))}</span></div>
    <div class="row stack"><span class="row-title">Thoroughness</span>${seg('set-effort', Object.entries(EFFORTS), s.effort)}<span class="row-sub">${EFFORT_HINT[s.effort]}</span></div>
    ${switchRow('webLookup', 'Look up restaurants and brands', 'When you name a chain or a packaged product, Claude checks its official nutrition online. Adds a few seconds and a few cents.')}
  </div>

  <h2 class="label">Garmin</h2>
  <div class="card list">
    <button class="row" data-act="open-relay">${icon('watch')}<span class="row-main"><span class="row-title">Garmin relay</span>
      <span class="row-sub">${garminConnected() ? `Connected · synced ${esc(ago(g.lastSync))}${g.lastError ? ` · ${esc(g.lastError)}` : ''}` : 'Not connected'}</span></span>${icon('chev', 'end')}</button>
    ${switchRow('flex', 'Adjust my target for activity', 'On days Garmin records more activity than usual, half the extra goes on your calories. Once a quiet day is over, its target drops by half the shortfall.')}
  </div>

  <h2 class="label">Coach</h2>
  <div class="card list">
    <div class="row stack"><span class="row-title">Tone</span>${seg('set-tone', [['tough', 'Tough love'], ['straight', 'Straight'], ['gentle', 'Gentle']], s.tone)}</div>
    <div class="row stack"><span class="row-title">Suggest alternatives</span>${seg('set-swaps', [['auto', 'If it doesn\'t fit'], ['always', 'Always'], ['ask', 'If I ask']], s.swaps)}</div>
    <label class="row stack"><span class="row-title">Your food notes</span>
      <textarea class="input" rows="3" data-bind="set-notes" placeholder="e.g. No pork. Lactose intolerant. Love Korean food, hate mushrooms.">${esc(s.notes)}</textarea>
      <span class="row-sub">Claude reads these before every estimate and suggestion.</span></label>
  </div>

  <h2 class="label">Spending</h2>
  <div class="card list">
    <div class="row"><span class="row-main"><span class="row-title">This month</span><span class="row-sub">${m.calls} request${m.calls === 1 ? '' : 's'} · estimated from token counts</span></span><b class="money">$${m.usd.toFixed(2)}</b></div>
    ${prev.calls ? `<div class="row"><span class="row-main"><span class="row-title">Last month</span><span class="row-sub">${prev.calls} requests</span></span><b class="money">$${prev.usd.toFixed(2)}</b></div>` : ''}
    <a class="row" href="https://platform.claude.com/settings/limits" target="_blank" rel="noopener">${icon('link')}<span class="row-main"><span class="row-title">Set a monthly spend limit</span><span class="row-sub">In the Claude Console</span></span></a>
  </div>

  <h2 class="label">Your data</h2>
  <p class="muted small">Everything stays on this phone. Photos go to Anthropic only to be analyzed, and Plate keeps just a small thumbnail. Export a backup now and then: deleting the app from your Home Screen deletes its data.</p>
  <div class="card list">
    <button class="row" data-act="export">${icon('download')}<span class="row-main"><span class="row-title">Export backup</span><span class="row-sub">Save to Files, AirDrop, Notes or email</span></span></button>
    <label class="row">${icon('upload')}<span class="row-main"><span class="row-title">Import a backup file</span><span class="row-sub">Replaces what's on this phone</span></span>
      <input type="file" accept="application/json,.json" class="visually-hidden" data-bind="import-file"></label>
    <button class="row" data-act="import-paste">${icon('paste')}<span class="row-main"><span class="row-title">Paste a backup</span><span class="row-sub">If you saved it as text</span></span></button>
    <button class="row danger" data-act="reset">${icon('trash')}<span class="row-main"><span class="row-title">Erase everything</span></span></button>
  </div>

  <h2 class="label">About</h2>
  <div class="card list">
    <a class="row" href="#/about"><span class="row-main"><span class="row-title">How Plate works</span><span class="row-sub">Estimates, targets, Garmin and costs</span></span>${icon('chev', 'end')}</a>
    ${standalone() ? '' : '<div class="row"><span class="row-main"><span class="row-title">Install on iPhone</span><span class="row-sub">Open in Safari → Share → Add to Home Screen</span></span></div>'}
    <div class="row"><span class="row-main"><span class="row-title">Version</span><span class="row-sub">${APP_VERSION}${state.compat.safe ? ' · compatibility mode' : ''}</span></span></div>
  </div>`;
}

function aboutView() {
  return `<header class="top"><a class="back" href="#/settings">${icon('back')}Settings</a>
    <h1 class="title-md">How Plate works</h1></header>
    <article class="prose">${ABOUT_HTML}</article>`;
}

// ---------- Anthropic key ----------

export function openKeySheet() {
  const key = getApiKey();
  openSheet(`
    <div class="sheet-head"><h3 class="sheet-title">Anthropic API key</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
    <p class="muted small">Plate sends your photos and descriptions straight from this phone to Claude with your own key. The key stays on this phone and is never included in backups.</p>
    <ol class="steps">
      <li>Open <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com → API keys</a> and create a key. Use a personal account, not a work one.</li>
      <li>Add some credit under Billing, and set a monthly spend limit.</li>
      <li>Paste the key here.</li>
    </ol>
    <label class="field"><span>Key</span><input id="api-key" class="input mono" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${key ? 'Saved. Paste a new one to replace it' : 'sk-ant-…'}" data-enter="key-save"></label>
    <div class="sheet-actions">
      <button class="btn primary" data-act="key-save">${key ? 'Replace and test' : 'Save and test'}</button>
      ${key ? '<button class="btn secondary" data-act="key-test">Test the saved key</button><button class="btn ghost danger" data-act="key-remove">Remove key</button>' : ''}
    </div>
    <p id="key-status" class="hint" role="status"></p>`, { tag: 'key' });
}

async function testKey() {
  const status = document.getElementById('key-status');
  if (status) status.textContent = 'Testing…';
  try {
    const models = await testConnection();
    if (status) status.innerHTML = `${icon('check', 'inline')} Connected to ${esc(models)}.`;
    rerender();
    return true;
  } catch (e) {
    if (status) status.textContent = friendlyError(e);
    return false;
  }
}

// ---------- Garmin relay ----------

export function openRelaySheet() {
  const r = getRelay() || {};
  openSheet(`
    <div class="sheet-head"><h3 class="sheet-title">Garmin</h3><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('close')}</button></div>
    <p class="muted small">Plate reads your daily calories from Garmin through your own relay: a free Cloudflare Worker that holds your Garmin Personal API key. Set it up once with the steps in the README, then paste its address and passcode here.</p>
    <label class="field"><span>Relay address</span><input id="relay-url" class="input" type="url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://plate-relay.yourname.workers.dev" value="${esc(r.url || '')}"></label>
    <label class="field"><span>Relay passphrase</span><input id="relay-pass" class="input mono" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(r.pass || '')}" data-enter="relay-save"></label>
    <p class="hint">The same passphrase you set with <code>wrangler secret put RELAY_PASSCODE</code>.</p>
    <button class="mini" data-act="relay-gen">Make a new passcode</button>
    <div class="sheet-actions">
      <button class="btn primary" data-act="relay-save">Save and test</button>
      ${r.url ? '<button class="btn ghost danger" data-act="relay-remove">Disconnect Garmin</button>' : ''}
    </div>
    <p id="relay-status" class="hint" role="status"></p>`, { tag: 'relay' });
}

// ---------- backups ----------

const backupName = () => `plate-backup-${new Date().toISOString().slice(0, 10)}.json`;

// The share sheet is the reliable route on iPhone; download links can get stuck in
// Home Screen apps, so the fallback is copy and paste.
async function exportBackup() {
  const json = backupJSON();
  const file = new File([json], backupName(), { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Plate backup' }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  openSheet(`
    <h3 class="sheet-title">Your backup</h3>
    <p class="muted">Copy it and paste it into Notes or an email to yourself. To restore it, use Settings → Paste a backup.</p>
    <textarea id="backup-text" class="input mono" rows="6" readonly>${esc(json)}</textarea>
    <div class="sheet-actions">
      <button class="btn primary" data-act="backup-copy">Copy backup</button>
      ${standalone() ? '' : '<button class="btn ghost" data-act="backup-download">Download as a file</button>'}
    </div>`);
}

function downloadBackup() {
  const url = URL.createObjectURL(new Blob([backupJSON()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = backupName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function restore(text) {
  const data = parseBackup(text);
  const n = Object.values(data.days || {}).filter(d => d.entries?.length).length;
  if (!(await confirmSheet({ title: 'Replace the data on this phone?', body: `The backup has ${n} logged day${n === 1 ? '' : 's'}. What's here now will be replaced. Your API key and Garmin relay stay as they are.`, ok: 'Replace' }))) return;
  replaceState(data);
  toast('Backup restored');
  rerender();
}

// ---------- wiring ----------

export const actions = {
  'set-quick': el => { state.settings.quickModel = el.dataset.v; save(); rerender(); },
  'set-main': el => { state.settings.mainModel = el.dataset.v; save(); rerender(); },
  'set-effort': el => { state.settings.effort = el.dataset.v; save(); rerender(); },
  'set-tone': el => { state.settings.tone = el.dataset.v; save(); rerender(); },
  'set-swaps': el => { state.settings.swaps = el.dataset.v; save(); rerender(); },

  'open-key': openKeySheet,
  'key-save': async () => {
    const input = document.getElementById('api-key');
    const value = (input?.value || '').trim();
    if (!value) { input?.focus(); return; }
    if (!value.startsWith('sk-ant-')) {
      const status = document.getElementById('key-status');
      if (status) status.textContent = 'That doesn\'t look like an Anthropic key. They start with sk-ant-.';
      return;
    }
    setApiKey(value);
    if (input) input.value = '';
    await testKey();
  },
  'key-test': testKey,
  'key-remove': async () => {
    if (!(await confirmSheet({ title: 'Remove your API key?', body: 'Plate can\'t analyze food until you add one again.', ok: 'Remove', danger: true }))) return;
    setApiKey('');
    rerender();
    toast('Key removed');
  },

  'open-relay': openRelaySheet,
  'relay-gen': async () => {
    const input = document.getElementById('relay-pass');
    if (!input) return;
    input.value = randomPasscode();
    input.type = 'text';
    await copyText(input.value, 'New passcode copied. Use the same one in the relay.');
  },
  'relay-save': async () => {
    const url = (document.getElementById('relay-url')?.value || '').trim();
    const pass = (document.getElementById('relay-pass')?.value || '').trim();
    const status = document.getElementById('relay-status');
    if (!/^https:\/\//.test(url)) { if (status) status.textContent = 'The address should start with https://'; return; }
    if (pass.length < 8) { if (status) status.textContent = 'The passphrase needs at least 8 characters: use the same one you set in the relay.'; return; }
    if (status) status.textContent = 'Testing…';
    try {
      await testRelay({ url, pass });
      setRelay({ url, pass });
      state.garmin.firstSyncDone = false;
      state.garmin.lastWeightSync = 0;
      save();
      if (status) status.textContent = 'Connected. Fetching your last 4 weeks…';
      await syncGarmin({ force: true });
      if (status) status.innerHTML = `${icon('check', 'inline')} Connected to Garmin.`;
      rerender();
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  },
  'relay-remove': async () => {
    if (!(await confirmSheet({ title: 'Disconnect Garmin?', body: 'Calories already synced stay in Plate. Your relay keeps running until you delete it in Cloudflare.', ok: 'Disconnect', danger: true }))) return;
    setRelay(null);
    rerender();
    toast('Garmin disconnected');
  },

  export: exportBackup,
  'backup-copy': async () => {
    const box = document.getElementById('backup-text');
    try { await navigator.clipboard.writeText(box.value); } catch { box.select(); document.execCommand('copy'); }
    toast('Backup copied');
  },
  'backup-download': () => { downloadBackup(); closeSheet(); },
  'import-paste': () => openSheet(`
    <h3 class="sheet-title">Paste a backup</h3>
    <textarea id="restore-text" class="input mono" rows="7" placeholder='{"app":"plate", …}'></textarea>
    <div class="sheet-actions"><button class="btn primary" data-act="restore-paste">Restore</button></div>`),
  'restore-paste': async () => {
    const text = document.getElementById('restore-text').value;
    closeSheet();
    try { await restore(text); } catch (e) { toast(e.message?.startsWith('That') ? e.message : 'That doesn\'t look like a Plate backup.'); }
  },
  reset: async () => {
    if (!(await confirmSheet({ title: 'Erase everything?', body: 'Your log, targets, scans, weights, API key and Garmin connection will be deleted from this phone.', ok: 'Erase', danger: true }))) return;
    resetState();
    clearThumbs();
    go('#/welcome');
  },
};

export const binds = {
  'set-notes': el => { state.settings.notes = el.value.slice(0, 1000); save(); },
  'import-file': async el => {
    const file = el.files?.[0];
    if (!file) return;
    try { await restore(await file.text()); } catch (e) { toast(e.message?.startsWith('That') ? e.message : 'Couldn\'t read that file.'); } finally { el.value = ''; }
  },
};

export const routes = {
  settings: { html: settingsView, tab: 'settings' },
  about: { html: aboutView, tab: 'settings' },
};
