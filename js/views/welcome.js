// First run: what Plate does, connect Claude, set targets, then Garmin (optional).
import { state, save, getApiKey, setApiKey } from '../store.js';
import { num } from '../util.js';
import { icon, go, standalone } from '../ui.js';
import { testConnection, friendlyError, MOCK } from '../ai.js';
import { garminConnected } from '../garmin.js';
import { startScan } from './body.js';

const stepLabel = n => `<p class="eyebrow">Step ${n} of 3</p>`;

function intro() {
  return `<div class="welcome">
    <img class="welcome-icon" src="icons/icon-192.png" alt="" width="96" height="96">
    <h1>Plate</h1>
    <p class="lead">Snap or type what you eat. Claude works out the calories and macros, tells you what's left, and keeps you honest.</p>
    ${standalone() ? '' : `<div class="tip"><div><p class="tip-title">First, add Plate to your Home Screen</p>
      <p>In Safari, tap ${icon('share', 'inline')} <b>Share</b>, then <b>Add to Home Screen</b>, and open it from there. The Home Screen app keeps its own storage, separate from Safari, so set it up there.</p></div></div>`}
    <button class="btn primary big" data-act="w-step" data-v="2">${standalone() ? 'Set up' : 'Set up here anyway'}</button>
  </div>`;
}

function claudeStep() {
  const connected = MOCK || !!getApiKey();
  return `${stepLabel(1)}<h1 class="title-md">Connect Claude</h1>
  <p class="muted">Plate uses your own Anthropic API key. It's stored only on this phone, and your photos go straight to Anthropic.</p>
  ${connected ? `<div class="card pad ok-card">${icon('checkCircle')}<p><b>Connected.</b> You can change the key later in Settings.</p></div>
    <button class="btn primary big" data-act="w-step" data-v="3">Next</button>` : `
  <ol class="steps">
    <li>Open <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com → API keys</a> and create a key. Use a personal account, not a work one.</li>
    <li>Add some credit under Billing, and set a monthly spend limit.</li>
    <li>Paste the key below.</li>
  </ol>
  <label class="field"><span>API key</span><input id="welcome-key" class="input mono" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" data-enter="w-key"></label>
  <button class="btn primary big" data-act="w-key">Connect</button>
  <p id="welcome-status" class="hint" role="status"></p>
  <button class="btn ghost wide" data-act="w-step" data-v="3">Skip for now</button>`}`;
}

function targetsStep() {
  const t = state.targets;
  return `${stepLabel(2)}<h1 class="title-md">Your daily targets</h1>
  ${t ? `<div class="card pad">
      <div class="target-grid"><div><b>${num(t.kcal)}</b><span>kcal</span></div><div><b>${num(t.protein)} g</b><span>protein</span></div><div><b>${num(t.carbs)} g</b><span>carbs</span></div><div><b>${num(t.fat)} g</b><span>fat</span></div></div>
    </div>
    <p class="hint">You can change these any time in the Body tab.</p>
    <button class="btn primary big" data-act="w-step" data-v="4">Next</button>` : `
  <p class="muted">Snap your Evolt 360 results. Claude reads your BMR and lean mass, then suggests calories and macros for losing fat while building muscle. You check every number before it's saved.</p>
  <div class="btn-col">
    <label class="btn primary big">${icon('camera')}Snap my scan<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-bind="welcome-scan"></label>
    <label class="btn secondary big">${icon('image')}Choose a photo<input type="file" accept="image/*" class="visually-hidden" data-bind="welcome-scan"></label>
  </div>
  <button class="btn ghost wide" data-act="edit-targets">Enter or calculate them myself</button>
  <button class="btn ghost wide" data-act="w-step" data-v="4">Skip for now</button>`}`;
}

function garminStep() {
  return `${stepLabel(3)}<h1 class="title-md">Garmin <span class="muted">(optional)</span></h1>
  <p class="muted">Plate can read the calories your Garmin records each day, and give you more food on big training days. It needs a small relay you set up once (about 15 minutes, see the README).</p>
  ${garminConnected() ? `<div class="card pad ok-card">${icon('checkCircle')}<p><b>Garmin connected.</b></p></div>` : '<button class="btn secondary wide" data-act="open-relay">Connect Garmin now</button>'}
  <button class="btn primary big" data-act="w-done">Start logging</button>
  <p class="hint">You can connect Garmin later in Settings.</p>`;
}

function view(step) {
  const n = +step || 1;
  const body = n === 2 ? claudeStep() : n === 3 ? targetsStep() : n === 4 ? garminStep() : intro();
  return `<div class="welcome-wrap">${n > 1 ? `<a class="back" href="#/welcome/${n - 1}">${icon('back')}Back</a>` : ''}${body}</div>`;
}

export const actions = {
  'w-step': el => go(`#/welcome/${el.dataset.v}`),
  'w-key': async () => {
    const input = document.getElementById('welcome-key');
    const status = document.getElementById('welcome-status');
    const value = (input?.value || '').trim();
    if (!value) { input?.focus(); return; }
    if (!value.startsWith('sk-ant-')) { if (status) status.textContent = 'That doesn\'t look like an Anthropic key. They start with sk-ant-.'; return; }
    setApiKey(value);
    if (status) status.textContent = 'Testing…';
    try {
      const model = await testConnection();
      if (status) status.textContent = `Connected. ${model} is ready.`;
      go('#/welcome/3');
    } catch (e) {
      if (status) status.textContent = friendlyError(e);
    }
  },
  'w-done': () => {
    state.onboarded = true;
    save(true);
    go('#/');
  },
};

export const binds = {
  'welcome-scan': el => {
    const file = el.files?.[0];
    el.value = '';
    if (file) startScan(file, () => go('#/welcome/4'));
  },
};

export const routes = {
  welcome: { html: view, tabs: false },
};
