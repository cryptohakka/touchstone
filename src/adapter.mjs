// adapter.mjs
// The ONE place that knows anything signal-specific. Everything downstream
// (engine.mjs, gate.mjs) operates only on the canonical shape {t,p,z}.
//
// Hidden dependencies surfaced from the original harness and pulled in here:
//   1. field names           -> btcPrice / frZ were hard-coded in two files
//   2. snapshot cadence       -> SPH=12 (5-min bars) was a magic constant
//   3. decision-log schema    -> shadow_trades.json's pnl/side/entry-time fields
import fs from 'fs';
import { mean, sd } from './stats.mjs';

const readJSON = src => typeof src === 'string'
  ? JSON.parse(fs.readFileSync(src, 'utf8'))
  : src;

// dotted path getter: "directionSignal.frZ" or "frZ"
const dig = (obj, path) => path == null ? undefined
  : String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// --map price=btcPrice signal=frZ time=timestamp  ->  {time,price,signal}
export function parseMap(tokens) {
  const m = { time: 'timestamp', price: 'price', signal: 'signal' };
  for (const a of [].concat(tokens || [])) {
    const i = String(a).indexOf('=');
    if (i > 0) m[a.slice(0, i).trim()] = a.slice(i + 1).trim();
  }
  return m;
}

// raw array (or {snapshots|data:[...]}) -> canonical [{t,p,z}], finite, sorted
export function loadSeries(src, map = parseMap()) {
  const raw = readJSON(src);
  const arr = Array.isArray(raw) ? raw : (raw.snapshots || raw.data || []);
  return arr
    .map(x => ({
      t: Date.parse(dig(x, map.time) ?? x.timestamp),
      p: Number(dig(x, map.price)),
      z: Number(dig(x, map.signal)),
    }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.p) && Number.isFinite(x.z))
    .sort((a, b) => a.t - b.t);
}

// median Δt -> snapshots-per-hour. Replaces the hard-coded SPH=12.
export function inferCadence(series) {
  if (series.length < 2) return { dtMin: NaN, sph: NaN };
  const d = [];
  for (let i = 1; i < series.length; i++) d.push(series[i].t - series[i - 1].t);
  d.sort((a, b) => a - b);
  const dtMin = d[d.length >> 1] / 60000;
  return { dtMin, sph: Math.max(1, Math.round(60 / dtMin)) };
}

// z-score the signal to mean 0 / sd 1, so a threshold of 1.5 means "1.5 SD"
// for any signal — RSI, a 0..1 confidence score, anything. Use --standardize
// for signals that are not already centered z-scores.
export function standardizeSignal(series) {
  const zs = series.map(s => s.z);
  const m = mean(zs), s = sd(zs) || 1;
  return series.map(r => ({ ...r, z: (r.z - m) / s }));
}

// decision log (gate axis). Any one of these keys may carry the entry time.
const ENTRY_KEYS = ['entry_time', 'entryTime', 'opened_at', 'openedAt', 'entry_ts', 'timestamp', 'time', 'ts'];
const entryMs = t => {
  for (const k of ENTRY_KEYS) {
    if (t[k] != null) {
      const v = typeof t[k] === 'number' ? t[k] : Date.parse(t[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
};

// raw shadow/decision log -> canonical blocks [{entryMs, side|null, recordedPnl}]
// gateMap lets you point at differently-named keys, e.g.
//   { resolved:'blocked', side:'dir', pnl:'pnl_pct' }
// side values are normalized: long|l|buy|1 -> 'long'; short|s|sell|-1 -> 'short'.
const normSide = v => {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (['long', 'l', 'buy', '1'].includes(s)) return 'long';
  if (['short', 's', 'sell', '-1'].includes(s)) return 'short';
  return null;
};
export function loadDecisionLog(src, { pnlField, gateMap = {} } = {}) {
  const resolvedKey = gateMap.resolved || 'resolved';
  const sideKey = gateMap.side || 'side';
  const pnlKey = gateMap.pnl || pnlField || 'virtual_pnl_pct';
  const raw = readJSON(src);
  const arr = Array.isArray(raw) ? raw : (raw.trades || []);
  return arr
    .filter(t => t[resolvedKey] && Number.isFinite(Number(t[pnlKey])))
    .map(t => ({
      entryMs: entryMs(t),
      side: normSide(t[sideKey]),
      recordedPnl: Number(t[pnlKey]),
    }));
}
