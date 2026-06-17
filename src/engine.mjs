// engine.mjs
// Signal-alpha axis. Faithful extraction of gauntlet.mjs: the 5 stages are
// forward-return -> beta-adjust -> episode-collapse -> multiple-comparison -> power.
// Math is unchanged; the only differences vs the original are (a) it returns a
// structured object instead of printing, (b) SPH comes from the adapter instead
// of the magic constant 12, (c) labels are signal-neutral (HIGH/LOW, not SHORT/LONG).
import { pt2, mean, tt, zq } from './stats.mjs';

export function runAlpha(series, opts = {}) {
  const TH = opts.threshold ?? 1.5;
  const HS = opts.horizons ?? [6, 12, 24];   // in HOURS
  const GAP = opts.gap ?? 2;
  const SPH = opts.sph;                       // snapshots/hour, from adapter.inferCadence
  if (!Number.isFinite(SPH) || SPH < 1) throw new Error('runAlpha: sph (snapshots per hour) must be a positive integer');
  const s = series, n = s.length;

  const fwd = (i, H) => { const j = i + H * SPH; return j >= n ? null : (s[j].p - s[i].p) / s[i].p; };

  // collapse consecutive same-sign firings (index gap <= GAP+1) into episodes
  const EP = [];
  for (let i = 0; i < n; i++) {
    const sg = s[i].z >= TH ? 1 : s[i].z <= -TH ? -1 : 0;
    if (!sg) continue;
    const last = EP[EP.length - 1];
    if (last && last.sign === sg && (i - last.idx[last.idx.length - 1]) <= GAP + 1) last.idx.push(i);
    else EP.push({ sign: sg, idx: [i] });
  }

  const cells = [];
  for (const H of HS) {
    const all = [];
    for (let i = 0; i < n; i++) { const r = fwd(i, H); if (r != null) all.push(r); }
    const beta = mean(all); // market drift over horizon H, removed below
    for (const side of [1, -1]) {
      const label = `${H}h ${side > 0 ? 'HIGH-signal(z>=+TH)' : 'LOW-signal(z<=-TH)'}`;
      const fire = [];
      for (const e of EP) { if (e.sign !== side) continue; for (const i of e.idx) { const r = fwd(i, H); if (r != null) fire.push(r - beta); } }
      const ep = [];
      for (const e of EP) { if (e.sign !== side) continue; const rs = e.idx.map(i => fwd(i, H)).filter(r => r != null); if (rs.length) ep.push(mean(rs) - beta); }
      const tNaive = tt(fire), tEpisode = tt(ep), df = ep.length - 1, p = pt2(tEpisode, df);
      cells.push({ label, horizon: H, side, tNaive, tEpisode, df, p, meanEpisodePct: mean(ep) * 100, nEpisodes: ep.length, nFirings: fire.length });
    }
  }

  const M = cells.length, bonf = 0.05 / M;
  const sorted = [...cells].sort((a, b) => a.p - b.p);
  let bh = 0; for (let k = 0; k < sorted.length; k++) { if (sorted[k].p <= 0.05 * (k + 1) / M) bh = k + 1; }

  const nEps = [...new Set(cells.map(c => c.nEpisodes))].sort((a, b) => a - b);
  const power = nEps.map(nn => ({
    nEpisodes: nn,
    minDetectableD_corrected: (zq(1 - bonf / 2) + zq(0.8)) / Math.sqrt(nn),
    minDetectableD_uncorrected: (zq(0.975) + zq(0.8)) / Math.sqrt(nn),
  }));

  return {
    nSnapshots: n,
    window: { from: new Date(s[0].t).toISOString(), to: new Date(s[n - 1].t).toISOString() },
    threshold: TH, horizonsHours: HS, gap: GAP, sph: SPH,
    episodes: EP.length,
    episodesBySide: { high: EP.filter(e => e.sign > 0).length, low: EP.filter(e => e.sign < 0).length },
    cells,
    multipleComparison: {
      M, bonferroniAlpha: bonf,
      bonferroniSurvivors: cells.filter(c => c.p < bonf).map(c => c.label),
      bhRejected: sorted.slice(0, bh).map(c => c.label),
      minP: sorted[0]?.p, minPLabel: sorted[0]?.label,
    },
    power,
  };
}
