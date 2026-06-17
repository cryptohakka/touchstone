// gate.mjs
// Gate-selectivity axis (GST). Faithful extraction of council_test_fixed.mjs.
// Both fixes from that file are preserved BY CONSTRUCTION:
//   BUG① fix: bootstrap side is derived from each drawn point's OWN signal
//             (sideRule), never the recorded side list.
//   BUG② fix: the actual gate mean is recomputed with the SAME pnlAt formula
//             used for the baseline; recorded values are only a cross-check.
// This is the cross-project guard from the memo: actual and baseline must never
// be computed on different bases.
import { mean } from './stats.mjs';

export function runGate(series, blocks, opts = {}) {
  const HMS = opts.hms ?? 30 * 60 * 1000;
  const LEV = opts.lev ?? 2;
  const FEE = opts.fee ?? (0.0006 + 0.0006) * LEV * 100;
  const TH = opts.threshold ?? 1.5;
  const B = opts.B ?? 10000;
  // signal -> intended side. Default = sign-based contrarian (frZ semantics).
  // Override for non-contrarian or non-centered signals.
  const sideOf = opts.sideRule ?? (z => z >= 0 ? 'short' : 'long');
  const s = series, n = s.length;

  const pnlAt = (idx, side) => {
    const tgt = s[idx].t + HMS; let j = idx; while (j < n && s[j].t < tgt) j++;
    if (j >= n) return null;
    const raw = (s[j].p - s[idx].p) / s[idx].p * (side === 'long' ? 1 : -1);
    return raw * LEV * 100 - FEE;
  };
  const idxAtTime = ms => {
    if (!Number.isFinite(ms)) return null;
    let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].t < ms) lo = m + 1; else hi = m; }
    return lo < n ? lo : null;
  };

  // ---- actual gate result: recorded vs recomputed (BUG② guard) ----
  const actRec = blocks.map(t => t.recordedPnl);
  const actMeanRec = mean(actRec);
  const recomp = []; let mapped = 0;
  for (const t of blocks) {
    const i = idxAtTime(t.entryMs); if (i == null) continue;
    const side = t.side || sideOf(s[i].z);
    const r = pnlAt(i, side); if (r == null) continue;
    recomp.push(r); mapped++;
  }
  const actMeanRecomp = recomp.length ? mean(recomp) : NaN;
  const cov = blocks.length ? mapped / blocks.length : 0;
  const useRecomp = Number.isFinite(actMeanRecomp) && mapped >= 0.9 * blocks.length;
  const actMean = useRecomp ? actMeanRecomp : actMeanRec;

  // ---- baseline bootstrap (BUG① guard: side from drawn point's own signal) ----
  const K = blocks.length;
  const sidesRec = blocks.map(t => t.side);
  const sideFixed = idx => sideOf(s[idx].z);
  const sideLegacy = (idx, k) => sidesRec[k % sidesRec.length] || sideOf(s[idx].z); // DIAG only
  const boot = (pool, sideFn) => {
    const out = [];
    for (let b = 0; b < B; b++) {
      const picks = [];
      for (let k = 0; k < K; k++) {
        const idx = pool[Math.floor(Math.random() * pool.length)];
        const r = pnlAt(idx, sideFn(idx, k));
        if (r == null) { k--; continue; }
        picks.push(r);
      }
      out.push(mean(picks));
    }
    out.sort((a, b) => a - b);
    return { out, below: out.filter(x => x <= actMean).length / B };
  };

  const poolA = [...Array(n).keys()];
  const poolB = []; for (let i = 0; i < n; i++) if (Math.abs(s[i].z) >= TH) poolB.push(i);

  const report = pool => {
    const { out, below } = boot(pool, sideFixed);
    const r = {
      size: pool.length, randomMean: mean(out),
      p5: out[(B * 0.05) | 0], p50: out[(B * 0.5) | 0], p95: out[(B * 0.95) | 0],
      councilMean: actMean, percentile: below, selective: below < 0.05,
    };
    if (opts.diag) { const { below: bL } = boot(pool, sideLegacy); r.diagLegacyPercentile = bL; }
    return r;
  };

  return {
    horizonMin: HMS / 60000, lev: LEV, fee: FEE,
    nBlocks: K, nSnapshots: n,
    recordedMean: actMeanRec, recomputedMean: actMeanRecomp,
    mappedCoverage: cov, basisUsed: useRecomp ? 'recomputed' : 'recorded',
    coverageWarning: !useRecomp,
    poolA: report(poolA),
    poolB: report(poolB),
  };
}
