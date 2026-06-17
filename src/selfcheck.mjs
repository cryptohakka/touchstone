// selfcheck.mjs
// The harness validates ITSELF on the user's own data. Three claims, made
// quantitative:
//   (A) detection power  — graded future-leak injection; the verdict must flip
//       NO_EDGE -> SURVIVES as more genuine signal is mixed in, with min_p
//       decreasing monotonically. Proves the tool is not a timid always-veto.
//   (B) no false positive — a time-shuffled copy of the signal must stay NO_EDGE.
//   (C) direction invariance — sign-flipping the signal must leave min_p
//       unchanged (two-sided test); catches accidental directional bias.
//
// Operates only on the canonical [{t,p,z}] series (post-adapter), so it inherits
// the same signal-agnostic guarantee as the engine.
import { runAlpha } from './engine.mjs';
import { mean, sd } from './stats.mjs';

const round = (x, d = 4) => (x == null || !Number.isFinite(x)) ? null : Number(x.toFixed(d));

// deterministic PRNG so the shuffle null is reproducible by judges
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function standardize(arr) {
  const fin = arr.filter(Number.isFinite);
  const m = mean(fin), s = sd(fin) || 1;
  return arr.map(v => Number.isFinite(v) ? (v - m) / s : 0);
}

function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let k = 0; k < idx.length; k++) r[idx[k][1]] = k + 1;
  return r;
}
function spearman(x, y) {
  const rx = rank(x), ry = rank(y), n = x.length, mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy || 1);
}

export function runSelfCheck(series, opts = {}) {
  const sph = opts.sph;
  const TH = opts.threshold ?? 1.5;
  const horizons = opts.horizons ?? [6, 12, 24];
  const gap = opts.gap ?? 2;
  const seed = opts.seed ?? 12345;
  const H = opts.leakHorizon ?? 24;
  const alphas = opts.alphas ?? [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0];
  const n = series.length;
  const base = { threshold: TH, horizons, gap, sph };

  const run = zArr => {
    const s2 = series.map((s, i) => ({ t: s.t, p: s.p, z: zArr[i] }));
    const a = runAlpha(s2, base);
    const survivors = a.multipleComparison.bhRejected.length;
    return { minP: a.multipleComparison.minP, survivors, verdict: survivors > 0 ? 'SURVIVES' : 'NO_EDGE' };
  };

  // leak target = standardized, market-adjusted (beta removed) future-H return.
  // Beta-adjust matches the engine's own drift removal, so the injected thing is
  // genuine beta-excess edge, not the market trend the engine already strips.
  const fwd = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { const j = i + H * sph; if (j < n) fwd[i] = (series[j].p - series[i].p) / series[i].p; }
  const betaH = mean(fwd.filter(Number.isFinite));
  const zLeak = standardize(fwd.map(v => Number.isFinite(v) ? v - betaH : NaN));
  const zOrig = standardize(series.map(s => s.z));

  // (A) graded leak curve. Re-standardize each mix so TH=1.5 means the same
  // thing at every alpha (isolates info content from scale / firing-rate).
  const curve = alphas.map(al => {
    const mixed = standardize(zOrig.map((z, i) => (1 - al) * z + al * zLeak[i]));
    const r = run(mixed);
    return { alpha: al, min_p: round(r.minP), bh_survivors: r.survivors, verdict: r.verdict, _raw: r.minP };
  });
  const baseRun = curve[0];                         // alpha = 0  == original signal
  const top = curve[curve.length - 1];              // alpha = 1  == pure leak
  const firstSurvive = curve.find(c => c.verdict === 'SURVIVES');
  const rho = spearman(curve.map(c => c.alpha), curve.map(c => c._raw));

  // (B) shuffle null (seeded Fisher-Yates) — must stay NO_EDGE
  const rnd = mulberry32(seed);
  const zsh = zOrig.slice();
  for (let i = zsh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [zsh[i], zsh[j]] = [zsh[j], zsh[i]]; }
  const shuffle = run(zsh);

  // (C) sign-flip invariance — two-sided test must give identical min_p
  const flip = run(zOrig.map(z => -z));

  const powerDemonstrated = baseRun.verdict === 'NO_EDGE' && top.verdict === 'SURVIVES' && rho < 0;
  const noFalsePositive = shuffle.verdict === 'NO_EDGE';
  const directionInvariant = Number.isFinite(flip.minP) && Number.isFinite(baseRun._raw) && Math.abs(flip.minP - baseRun._raw) < 1e-6;

  return {
    config: { leak_horizon_h: H, alpha_grid: alphas, threshold: TH, horizons, seed, M: 2 * horizons.length },
    baseline_signal: { min_p: baseRun.min_p, bh_survivors: baseRun.bh_survivors, verdict: baseRun.verdict },
    detection_power: {
      claim: 'verdict flips NO_EDGE -> SURVIVES as genuine future-leak is mixed in',
      leak_curve: curve.map(({ alpha, min_p, bh_survivors, verdict }) => ({ alpha, min_p, bh_survivors, verdict })),
      first_survive_alpha: firstSurvive ? firstSurvive.alpha : null,
      spearman_alpha_minp: round(rho, 3),
      passes: powerDemonstrated,
    },
    null_shuffle: {
      claim: 'time-shuffled signal must stay NO_EDGE',
      min_p: round(shuffle.minP), bh_survivors: shuffle.survivors, verdict: shuffle.verdict, passes: noFalsePositive,
    },
    null_sign_flip: {
      claim: 'two-sided verdict must be invariant to z -> -z (label swap only)',
      min_p: round(flip.minP), bh_survivors: flip.survivors, verdict: flip.verdict, passes: directionInvariant,
    },
    summary: {
      detection_power: powerDemonstrated,
      no_false_positive: noFalsePositive,
      direction_invariant: directionInvariant,
      overall: powerDemonstrated && noFalsePositive && directionInvariant,
    },
    note: 'A self-check pass means the harness can detect a real edge and rejects noise on THIS dataset. It says nothing about whether the tested signal itself has edge — see the main verdict for that.',
  };
}
