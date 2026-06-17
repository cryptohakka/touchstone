// verdict.mjs
// Standardizes the two axes into one machine-readable verdict. The orthogonality
// notes are not decoration — they are the honesty contract: a SURVIVES or
// SELECTIVE result is necessary, not sufficient, for profitability.
const round = (x, d) => (x == null || !Number.isFinite(x)) ? null : Number(x.toFixed(d));

export function alphaVerdict(a) {
  const survives = a.multipleComparison.bhRejected.length > 0;
  return {
    axis: 'signal_alpha',
    verdict: survives ? 'SURVIVES' : 'NO_EDGE',
    n_snapshots: a.nSnapshots,
    window: a.window,
    n_episodes: a.episodes,
    episodes_by_side: a.episodesBySide,
    threshold: a.threshold,
    cadence_snapshots_per_hour: a.sph,
    horizons_hours: a.horizonsHours,
    multiple_comparison: {
      method: 'BH', M: a.multipleComparison.M,
      bh_rejected: a.multipleComparison.bhRejected,
      bonferroni_survivors: a.multipleComparison.bonferroniSurvivors,
      min_p: round(a.multipleComparison.minP, 4),
      min_p_cell: a.multipleComparison.minPLabel,
    },
    power: a.power.map(p => ({ n_episodes: p.nEpisodes, min_detectable_d: round(p.minDetectableD_corrected, 2) })),
    note: 'No detectable edge != no edge exists. This verdict is bounded by statistical power at the episode-level n above.',
  };
}

export function gateVerdict(g) {
  return {
    axis: 'gate_selectivity',
    verdict: g.poolB.selective ? 'SELECTIVE' : 'NOT_SELECTIVE',
    horizon_min: g.horizonMin,
    execution: { leverage: g.lev, fee_pct: round(g.fee, 3) },
    n_blocks: g.nBlocks,
    basis_used: g.basisUsed,
    mapped_coverage: round(g.mappedCoverage, 2),
    coverage_warning: g.coverageWarning,
    firing_pool: { size: g.poolB.size, gate_mean: round(g.poolB.councilMean, 4), random_mean: round(g.poolB.randomMean, 4), percentile: round(g.poolB.percentile * 100, 1) },
    all_pool: { size: g.poolA.size, percentile: round(g.poolA.percentile * 100, 1) },
    note: 'Gate selectivity is orthogonal to PnL. SELECTIVE means the gate rejects worse-than-random trades from the firing population; it does NOT mean the system is profitable.',
  };
}

export function combined(av, gv) {
  return {
    tool: 'touchstone', version: '0.1.0', generated_at: new Date().toISOString(),
    headline: gv ? `signal: ${av.verdict} | gate: ${gv.verdict}` : `signal: ${av.verdict}`,
    signal_alpha: av,
    gate_selectivity: gv || null,
    disclaimer: 'Both axes are orthogonal to realized PnL. A SURVIVES / SELECTIVE result is necessary, not sufficient, for a profitable system.',
  };
}
