// The numbers: entry and day totals, targets from a body scan, the Garmin flex,
// streaks, date ranges and the adaptive "what you really burn" estimate.
import { state, day } from './store.js';
import { round, clamp, sum, mean, addDays, dayKey, daysBetween } from './util.js';

export const GOALS = {
  lose: { label: 'Lose fat', blurb: 'About 20% below what you burn', adjust: -0.2 },
  recomp: { label: 'Recomp', blurb: 'Lose fat and keep building muscle: about 10% below what you burn', adjust: -0.1 },
  maintain: { label: 'Maintain', blurb: 'Eat about what you burn', adjust: 0 },
  gain: { label: 'Build', blurb: 'About 10% above what you burn, for muscle gain', adjust: 0.1 },
};

export const ACTIVITY = [
  { v: 1.375, label: 'Light', blurb: '1–3 workouts a week' },
  { v: 1.55, label: 'Active', blurb: '3–5 workouts a week' },
  { v: 1.725, label: 'Very active', blurb: '6–7 hard sessions a week' },
];

const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat'];
export const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });

export function addTo(total, part, k = 1) {
  for (const n of NUTRIENTS) total[n] += (Number(part?.[n]) || 0) * k;
  return total;
}

export const rounded = t => ({ kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) });

export const itemsTotal = (items, k = 1) => rounded((items || []).reduce((t, it) => addTo(t, it, k), zero()));

// What an entry counts for: the user's own numbers if they typed them, otherwise
// Claude's items times the portion the user picked.
export function entryTotals(e) {
  if (e.override) return rounded({ ...zero(), ...e.override });
  return itemsTotal(e.items, e.scale || 1);
}

export function dayTotals(key, { exclude } = {}) {
  return rounded(day(key).entries.filter(e => e.id !== exclude).reduce((t, e) => addTo(t, entryTotals(e)), zero()));
}

export const isLogged = key => day(key).entries.length > 0;

// ---------- targets ----------

// From a body scan (best: its measured BMR and lean mass) or, failing that, from
// height, weight and age with the Mifflin-St Jeor formula.
export function computeTargets({ bmr, leanKg, weightKg, sex, age, heightCm, activity = 1.55, goal = 'recomp' }) {
  let bmrUsed = Number(bmr) || 0;
  let bmrSource = 'scan';
  if (!bmrUsed && leanKg) { bmrUsed = 370 + 21.6 * leanKg; bmrSource = 'lean'; }
  if (!bmrUsed && weightKg && heightCm && age) {
    const sexTerm = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
    bmrUsed = 10 * weightKg + 6.25 * heightCm - 5 * age + sexTerm;
    bmrSource = 'formula';
  }
  if (!bmrUsed) return null;
  const g = GOALS[goal] || GOALS.recomp;
  const deficit = g.adjust < 0;
  const maintenance = bmrUsed * activity;
  const kcal = round(maintenance * (1 + g.adjust), 10);
  let protein;
  let proteinRule;
  if (leanKg) {
    const perKg = deficit ? 2.4 : 2.2;
    protein = round(leanKg * perKg, 5);
    proteinRule = `${perKg} g per kg of lean mass`;
  } else if (weightKg) {
    const perKg = deficit ? 2.0 : 1.8;
    protein = round(weightKg * perKg, 5);
    proteinRule = `${perKg} g per kg of body weight`;
  } else {
    protein = round((kcal * 0.3) / 4, 5);
    proteinRule = '30% of calories';
  }
  const fat = round(Math.max((kcal * 0.3) / 9, (weightKg || 0) * 0.7), 5);
  const carbs = Math.max(50, round((kcal - protein * 4 - fat * 9) / 4, 5));
  return {
    kcal, protein, carbs, fat,
    basis: { bmr: Math.round(bmrUsed), bmrSource, activity, goal, maintenance: Math.round(maintenance), proteinRule },
  };
}

// Refill carbs from whatever calories protein and fat leave.
export function balanceCarbs(t) {
  return { ...t, carbs: Math.max(0, round((t.kcal - t.protein * 4 - t.fat * 9) / 4, 5)) };
}

// ---------- Garmin flex ----------

// Average active calories over the previous 28 days (needs at least 5 days of data).
export function typicalActive(key) {
  const vals = [];
  for (let i = 1; i <= 28; i++) {
    const b = state.burn[addDays(key, -i)];
    if (b && Number.isFinite(b.active)) vals.push(b.active);
  }
  return vals.length >= 5 ? Math.round(mean(vals)) : null;
}

// Half the difference between the day's active calories and a typical day's.
// Today only moves up: active calories keep rising until the day ends, so cutting
// the target in the morning would be wrong. Finished days move both ways.
export function flexFor(key) {
  if (!state.settings.flex || !state.targets) return 0;
  const b = state.burn[key];
  if (!b || !Number.isFinite(b.active)) return 0;
  const typical = typicalActive(key);
  if (typical == null) return 0;
  let f = 0.5 * (b.active - typical);
  if (key >= dayKey()) f = Math.max(0, f);
  return round(clamp(f, -300, 500), 5);
}

export function targetFor(key) {
  const t = state.targets;
  if (!t) return null;
  const flex = flexFor(key);
  return { kcal: t.kcal + flex, protein: t.protein, carbs: Math.max(0, t.carbs + Math.round(flex / 4)), fat: t.fat, flex, base: t.kcal };
}

// ---------- verdicts and streaks ----------

export function kcalStatus(eaten, target) {
  if (!target) return 'none';
  const left = target - eaten;
  if (left < -25) return 'over';
  if (left < 150) return 'tight';
  return 'fits';
}

// On target: calories within 10% of the target and protein at least 90% of it.
export function onTarget(totals, target) {
  return !!target && totals.kcal > 0 && Math.abs(totals.kcal - target.kcal) <= target.kcal * 0.1 && totals.protein >= target.protein * 0.9;
}

export function streaks(today = dayKey()) {
  let logged = 0;
  for (let k = isLogged(today) ? today : addDays(today, -1); isLogged(k) && logged < 3650; k = addDays(k, -1)) logged++;
  const on = key => isLogged(key) && onTarget(dayTotals(key), targetFor(key));
  let onCount = 0;
  for (let k = on(today) ? today : addDays(today, -1); on(k) && onCount < 3650; k = addDays(k, -1)) onCount++;
  return { logged, onTarget: onCount };
}

// The last n days ending on endKey, oldest first, with averages over finished logged days.
export function range(endKey, n) {
  const today = dayKey();
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDays(endKey, -i);
    const totals = dayTotals(key);
    const target = targetFor(key);
    const logged = isLogged(key);
    days.push({
      key, totals, target, logged,
      on: logged && onTarget(totals, target),
      over: logged && !!target && totals.kcal > target.kcal * 1.05,
      burn: state.burn[key] || null,
      today: key === today,
    });
  }
  const done = days.filter(d => d.logged && !d.today);
  const pool = done.length ? done : days.filter(d => d.logged);
  const avg = f => (pool.length ? Math.round(mean(pool.map(f))) : null);
  const burnDays = days.filter(d => d.burn && !d.today);
  return {
    days,
    avg: { kcal: avg(d => d.totals.kcal), protein: avg(d => d.totals.protein), carbs: avg(d => d.totals.carbs), fat: avg(d => d.totals.fat) },
    avgTarget: pool.length && pool.every(d => d.target) ? Math.round(mean(pool.map(d => d.target.kcal))) : state.targets?.kcal ?? null,
    loggedCount: days.filter(d => d.logged).length,
    finishedCount: done.length,
    onCount: done.filter(d => d.on).length,
    overCount: done.filter(d => d.over).length,
    avgActive: burnDays.length ? Math.round(mean(burnDays.map(d => d.burn.active))) : null,
  };
}

// A short summary of the last 7 finished days, for the coach.
export function patternText(key) {
  const r = range(addDays(key, -1), 7);
  const logged = r.days.filter(d => d.logged);
  if (!logged.length) return 'No earlier days logged yet.';
  const t = state.targets;
  const short = logged.filter(d => d.target && d.totals.protein < d.target.protein * 0.9).length;
  const late = logged.reduce((n, d) => n + day(d.key).entries.filter(e => new Date(e.at).getHours() >= 21).length, 0);
  return `The 7 days before this one: logged ${logged.length} of 7. Average ${r.avg.kcal} kcal a day (target ${t?.kcal ?? 'not set'}), protein ${r.avg.protein} g (target ${t?.protein ?? 'not set'}). Over the calorie target on ${r.overCount} day(s); protein short on ${short} day(s); ${late} item(s) logged after 9 pm.`;
}

// ---------- adaptive maintenance ----------

// What you really burn, from logged intake and the weight trend over the last 4 weeks:
// maintenance = average intake - (weight change per day x 7,700 kcal per kg).
export function adaptive(today = dayKey()) {
  const end = addDays(today, -1);
  const start = addDays(end, -27);
  const need = { days: 14, weighIns: 4 };
  const logged = [];
  for (let k = start; k <= end; k = addDays(k, 1)) {
    if (!isLogged(k)) continue;
    const t = dayTotals(k);
    const target = targetFor(k);
    if (!target || t.kcal >= target.kcal * 0.5) logged.push(t.kcal); // skip days that look half-logged
  }
  const ws = state.weights.filter(w => w.date >= start && w.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const progress = { days: logged.length, weighIns: ws.length };
  const span = ws.length > 1 ? daysBetween(ws[0].date, ws[ws.length - 1].date) : 0;
  if (logged.length < need.days || ws.length < need.weighIns || span < 10) return { ready: false, progress, need };
  const xs = ws.map(w => daysBetween(start, w.date));
  const ys = ws.map(w => w.kg);
  const mx = mean(xs);
  const my = mean(ys);
  const den = sum(xs.map(x => (x - mx) ** 2));
  const slope = den ? sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / den : 0; // kg per day
  const intake = Math.round(mean(logged));
  const maintenance = round(intake - slope * 7700, 10);
  if (maintenance < 1000 || maintenance > 5000) return { ready: false, progress, need, odd: true };
  const g = GOALS[state.profile.goal] || GOALS.recomp;
  return { ready: true, progress, need, intake, perWeek: slope * 7, maintenance, suggested: round(maintenance * (1 + g.adjust), 10) };
}
