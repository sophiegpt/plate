// Trends: streaks, calories per day against the target, averages and every day's line.
import { state } from '../store.js';
import { range, streaks } from '../nutrition.js';
import { esc, num, dayKey, dayTitle, weekdayShort, parseDay, plural } from '../util.js';
import { icon, go, bindTips } from '../ui.js';

let span = 7;

const barPath = (x, yTop, w, yBase, r = 4) => {
  const rr = Math.max(0, Math.min(r, w / 2, yBase - yTop));
  return `M${x},${yBase}V${yTop + rr}Q${x},${yTop} ${x + rr},${yTop}H${x + w - rr}Q${x + w},${yTop} ${x + w},${yTop + rr}V${yBase}Z`;
};

function chart(r) {
  const days = r.days;
  const n = days.length;
  const W = 340;
  const H = 180;
  const padL = 36;
  const padR = 6;
  const padT = 14;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const base = state.targets?.kcal || 0;
  const maxVal = Math.max(base * 1.2, ...days.map(d => d.totals.kcal), 1000);
  const step = maxVal > 3200 ? 1000 : 500;
  const top = Math.ceil(maxVal / step) * step;
  const y = v => padT + plotH - (v / top) * plotH;
  const band = plotW / n;
  const bw = Math.min(24, Math.max(3, band * 0.62));
  const ticks = [];
  const tickStep = top / step > 5 ? step * 2 : step;
  for (let v = 0; v <= top; v += tickStep) {
    ticks.push(`<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`);
  }
  const bars = [];
  const labels = [];
  const hits = [];
  days.forEach((d, i) => {
    const x = padL + band * i + (band - bw) / 2;
    if (d.logged && d.totals.kcal > 0) {
      bars.push(`<path class="bar ${d.over ? 'over' : ''} ${d.today ? 'today' : ''}" d="${barPath(x, y(d.totals.kcal), bw, y(0))}"/>`);
    } else {
      bars.push(`<line class="nolog" x1="${x + bw / 2 - 3}" x2="${x + bw / 2 + 3}" y1="${y(0) - 2}" y2="${y(0) - 2}"/>`);
    }
    const showLabel = n <= 7 || i === n - 1 || (n - 1 - i) % 7 === 0;
    if (showLabel) {
      const text = n <= 7 ? weekdayShort(d.key) : String(parseDay(d.key).getDate());
      labels.push(`<text class="axis" x="${padL + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${esc(text)}</text>`);
    }
    hits.push(`<rect class="hit" data-key="${d.key}" x="${padL + band * i}" y="${padT}" width="${band}" height="${plotH}" tabindex="0" role="button" aria-label="${esc(tipText(d))}"/>`);
  });
  const targetLine = base
    ? `<line class="target-line" x1="${padL}" x2="${W - padR}" y1="${y(base)}" y2="${y(base)}"/>`
    : '';
  return `<div class="chart-wrap">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories per day for the last ${n} days">
      ${ticks.join('')}${bars.join('')}${targetLine}${labels.join('')}${hits.join('')}
    </svg>
    <div class="chart-tip" id="chart-tip" role="status" hidden></div>
  </div>
  <div class="legend">
    <span><i class="key-bar"></i>Calories</span>
    <span><i class="key-bar over"></i>Over target ${icon('alert', 'inline')}</span>
    ${base ? `<span><i class="key-line"></i>Target ${num(base)}</span>` : ''}
  </div>`;
}

function tipText(d) {
  if (!d.logged) return `${dayTitle(d.key)}: not logged`;
  const t = d.target ? ` of ${num(d.target.kcal)}` : '';
  return `${dayTitle(d.key)}: ${num(d.totals.kcal)}${t} kcal · protein ${num(d.totals.protein)} g${d.burn ? ` · ${num(d.burn.active)} active` : ''}`;
}

function meter(label, avg, target, unit) {
  if (avg == null || !target) return '';
  const frac = Math.min(1, avg / target);
  const over = avg > target * 1.05;
  return `<div class="meter-row">
    <div class="meter-head"><span>${label}</span><span><b>${num(avg)}</b> of ${num(target)}${unit}</span></div>
    <div class="meter ${over ? 'over' : ''}"><span style="width:${(frac * 100).toFixed(1)}%"></span></div>
  </div>`;
}

function view() {
  const today = dayKey();
  const r = range(today, span);
  const st = streaks(today);
  const t = state.targets;
  const list = [...r.days].reverse();
  return `
  <header class="top"><h1>Trends</h1></header>
  <div class="stat-grid two">
    <div class="stat hero-stat">${icon('flame')}<b>${plural(st.logged, 'day')}</b><span>logged in a row</span></div>
    <div class="stat hero-stat">${icon('checkCircle')}<b>${plural(st.onTarget, 'day')}</b><span>on target in a row</span></div>
  </div>
  <div class="seg range-seg" role="group" aria-label="Time range">
    ${[7, 30].map(v => `<button class="${span === v ? 'on' : ''}" data-act="span" data-v="${v}" aria-pressed="${span === v}">${v} days</button>`).join('')}
  </div>
  <section class="card pad">
    <h2 class="card-title">Calories per day</h2>
    ${chart(r)}
  </section>
  <div class="stat-grid">
    <div class="stat"><span>Average</span><b>${r.avg.kcal == null ? '–' : `${num(r.avg.kcal)} kcal`}</b><small>${r.avgTarget ? `target ${num(r.avgTarget)}` : 'no target set'}</small></div>
    <div class="stat"><span>Protein</span><b>${r.avg.protein == null ? '–' : `${num(r.avg.protein)} g`}</b><small>${t ? `target ${num(t.protein)} g` : ''}</small></div>
    <div class="stat"><span>On target</span><b>${r.finishedCount ? `${r.onCount} of ${r.finishedCount}` : '–'}</b><small>finished days logged</small></div>
    <div class="stat"><span>${r.avgActive != null ? 'Garmin active' : 'Days logged'}</span><b>${r.avgActive != null ? `${num(r.avgActive)} kcal` : `${r.loggedCount} of ${span}`}</b><small>${r.avgActive != null ? 'average a day' : 'in this range'}</small></div>
  </div>
  ${t && r.avg.kcal != null ? `<section class="card pad">
    <h2 class="card-title">Average macros</h2>
    ${meter('Protein', r.avg.protein, t.protein, ' g')}${meter('Carbs', r.avg.carbs, t.carbs, ' g')}${meter('Fat', r.avg.fat, t.fat, ' g')}
  </section>` : ''}
  <p class="hint">On target means calories within 10% of the day's target and protein at least 90% of yours. Today counts once the day is over.</p>
  <h2 class="label">Days</h2>
  <div class="card list">${list.map(d => `<a class="row" href="${d.today ? '#/' : `#/day/${d.key}`}">
    <span class="row-main"><span class="row-title">${esc(dayTitle(d.key))}</span>
    <span class="row-sub">${d.logged ? `${num(d.totals.kcal)}${d.target ? ` of ${num(d.target.kcal)}` : ''} kcal · protein ${num(d.totals.protein)} g` : 'Not logged'}</span></span>
    ${d.on ? `<span class="tag t-good">${icon('check', 'inline')} On target</span>` : d.over ? `<span class="tag t-critical">${icon('alert', 'inline')} Over</span>` : ''}
    ${icon('chev', 'end')}</a>`).join('')}</div>`;
}

// Tap a day to see its numbers; tap it again to open it.
function mount() {
  const days = range(dayKey(), span).days;
  bindTips(document.querySelector('.chart'), {
    text: key => { const d = days.find(x => x.key === key); return d ? tipText(d) : ''; },
    onOpen: key => go(key === dayKey() ? '#/' : `#/day/${key}`),
  });
}

export const actions = {
  span: el => { span = +el.dataset.v; go('#/trends'); },
};

export const routes = {
  trends: { html: view, mount, tab: 'trends' },
};
