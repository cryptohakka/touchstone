#!/usr/bin/env node
// index.mjs — CLI. Zero dependencies, Node 18+.
//   touchstone <input.json> [--map price=F signal=F time=F]
//                           [--threshold 1.5] [--horizons 6,12,24] [--gap 2] [--sph N]
//                           [--gate decisions.json] [--diag] [--json out.json]
import { parseMap, loadSeries, inferCadence, loadDecisionLog, standardizeSignal } from './adapter.mjs';
import { runAlpha } from './engine.mjs';
import { runGate } from './gate.mjs';
import { runSelfCheck } from './selfcheck.mjs';
import { alphaVerdict, gateVerdict, combined } from './verdict.mjs';

function parseArgv(argv) {
  const positional = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2), vals = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) vals.push(argv[++i]);
      opts[key] = vals.length === 0 ? true : vals.length === 1 ? vals[0] : vals;
    } else positional.push(a);
  }
  return { positional, opts };
}

const HELP = `touchstone — a falsification harness for trading signals (strategy evaluation & benchmarking)

USAGE
  touchstone <input.json> [options]
  node src/index.mjs <input.json> [options]

INPUT
  A JSON array of records, each with a timestamp, a price, and one scalar signal:
    [{ "timestamp": "2026-06-06T13:27:14Z", "price": 66682.1, "signal": -1.83 }, ...]
  Field names are yours; map them with --map if they differ from the defaults
  (time=timestamp price=price signal=signal).

OPTIONS
  --map k=field        map your field names; dotted paths ok (signal=directionSignal.frZ)
  --standardize        z-score the signal to mean 0 / sd 1 before testing
                       (use for non-centered signals: RSI, 0..1 confidence scores, ...)
  --threshold N        firing threshold on the signal (default 1.5; HIGH: z>=+N, LOW: z<=-N)
  --horizons a,b,c     forward-return horizons in hours (default 6,12,24)
  --gap N              max snapshot gap to merge consecutive firings into one episode (default 2)
  --sph N              snapshots per hour (default: inferred from median dt; set for parity)
  --gate <file>        also run the Gate Selectivity Test on a block/skip decision log
  --gate-map k=field   map decision-log keys: resolved=, side=, pnl= (e.g. resolved=blocked side=dir pnl=pnl_pct)
  --pnl-field NAME     shorthand for the decision-log pnl key (default virtual_pnl_pct)
  --leverage N         gate execution leverage (default 2)
  --fee N              gate round-trip fee in % (default 0.24 = 0.06% maker+taker, x2 legs, x2 lev)
  --selfcheck          validate the harness on this data (leak-injection + nulls); no gate needed
  --leak-horizon N     hours of future leak to inject in --selfcheck (default 24)
  --seed N             RNG seed for reproducible nulls (default 12345)
  --diag               also report the legacy side-assignment baseline (reproduces a prior bug)
  --json <file>        write the verdict JSON to a file instead of stdout
  --help, -h           show this help

EXAMPLES
  # signal-alpha verdict only (your fields are price/signal/timestamp)
  touchstone data.json

  # frZ example: fields are btcPrice/frZ, add the gate axis, write JSON
  touchstone examples/perceptrade-frz/input.json --map price=btcPrice signal=frZ \\
    --gate examples/perceptrade-frz/decisions.json --json verdict.json

  # an RSI signal (0..100) needs standardizing first
  touchstone rsi.json --map price=close signal=rsi14 --standardize

  # prove the harness has detection power on your own data
  touchstone data.json --map price=btcPrice signal=frZ --selfcheck --json selfcheck.json

OUTPUT
  Human summary -> stderr. Machine-readable verdict JSON -> stdout (or --json <file>).
  signal_alpha.verdict:    NO_EDGE | SURVIVES         (does the signal survive correction?)
  gate_selectivity.verdict: NOT_SELECTIVE | SELECTIVE  (does the gate beat random blocking?)
  Both axes are orthogonal to PnL: a pass is necessary, not sufficient, for profit.

EXIT CODES
  0 success · 1 bad usage / unusable input`;

const { positional, opts } = parseArgv(process.argv.slice(2));
const input = positional[0];
if (opts.help || opts.h || !input) {
  console.log(HELP);
  process.exit(input ? 0 : (opts.help || opts.h) ? 0 : 1);
}

const map = parseMap(opts.map);
let series = loadSeries(input, map);
if (series.length < 30) { console.error(`only ${series.length} usable rows after mapping — check --map (got price=${map.price} signal=${map.signal} time=${map.time})`); process.exit(1); }
if (opts.standardize) series = standardizeSignal(series);

const cad = inferCadence(series);
const sph = Number.isFinite(Number(opts.sph)) ? Number(opts.sph) : cad.sph;
const threshold = opts.threshold != null ? Number(opts.threshold) : 1.5;
const horizons = (typeof opts.horizons === 'string' ? opts.horizons : '6,12,24').split(',').map(Number).filter(Number.isFinite);

if (opts.selfcheck) {
  const sc = runSelfCheck(series, {
    sph, threshold, horizons, gap: opts.gap != null ? Number(opts.gap) : 2,
    leakHorizon: opts['leak-horizon'] != null ? Number(opts['leak-horizon']) : 24,
    seed: opts.seed != null ? Number(opts.seed) : undefined,
  });
  console.error(`SELF-CHECK on ${series.length} rows | leak-horizon=${sc.config.leak_horizon_h}h seed=${sc.config.seed}`);
  console.error(`baseline signal: ${sc.baseline_signal.verdict} (min_p=${sc.baseline_signal.min_p})`);
  console.error('leak curve (alpha -> min_p / survivors / verdict):');
  for (const c of sc.detection_power.leak_curve) console.error(`  a=${String(c.alpha).padEnd(4)} min_p=${String(c.min_p).padEnd(6)} surv=${c.bh_survivors} ${c.verdict}`);
  console.error(`  first SURVIVES at alpha=${sc.detection_power.first_survive_alpha} | spearman(alpha,min_p)=${sc.detection_power.spearman_alpha_minp}`);
  console.error(`null shuffle:   ${sc.null_shuffle.verdict} (min_p=${sc.null_shuffle.min_p}) -> ${sc.null_shuffle.passes ? 'PASS' : 'FAIL'}`);
  console.error(`null sign-flip: invariant=${sc.null_sign_flip.passes} (min_p=${sc.null_sign_flip.min_p}) -> ${sc.null_sign_flip.passes ? 'PASS' : 'FAIL'}`);
  console.error(`\nSELF-CHECK: detection=${sc.summary.detection_power} no-false-positive=${sc.summary.no_false_positive} direction-invariant=${sc.summary.direction_invariant} -> OVERALL ${sc.summary.overall ? 'PASS' : 'FAIL'}`);
  const json = JSON.stringify({ tool: 'touchstone', mode: 'selfcheck', version: '0.1.0', generated_at: new Date().toISOString(), ...sc }, null, 2);
  if (typeof opts.json === 'string') { const fs = await import('fs'); fs.writeFileSync(opts.json, json); console.error(`\nwrote ${opts.json}`); }
  else console.log(json);
  process.exit(0);
}

const alpha = runAlpha(series, { threshold, horizons, gap: opts.gap != null ? Number(opts.gap) : 2, sph });
const av = alphaVerdict(alpha);

let gv = null;
if (opts.gate) {
  const gateMap = parseMap(opts['gate-map']); // reuse k=field parser
  const blocks = loadDecisionLog(opts.gate, { pnlField: typeof opts['pnl-field'] === 'string' ? opts['pnl-field'] : undefined, gateMap });
  if (!blocks.length) { console.error(`no resolved blocks found in ${opts.gate} — check --gate-map (resolved/side/pnl keys) and --pnl-field`); process.exit(1); }
  const gate = runGate(series, blocks, { threshold, diag: !!opts.diag, fee: opts.fee != null ? Number(opts.fee) : undefined, lev: opts.leverage != null ? Number(opts.leverage) : undefined });
  gv = gateVerdict(gate);
}

const out = combined(av, gv);

// ---- human summary ----
console.error(`loaded ${series.length} rows | ${alpha.window.from} -> ${alpha.window.to} | cadence ~${cad.dtMin}min -> sph=${sph} | TH=${threshold}`);
console.error(`episodes: ${alpha.episodes} (high=${alpha.episodesBySide.high}, low=${alpha.episodesBySide.low})`);
for (const c of alpha.cells) console.error(`  ${c.label}: episode t=${c.tEpisode.toFixed(2)} (nEp=${c.nEpisodes}) p=${c.p.toFixed(4)} | edge=${c.meanEpisodePct.toFixed(3)}%`);
console.error(`multiple comparison (M=${alpha.multipleComparison.M}): BH rejects ${alpha.multipleComparison.bhRejected.length} | min p=${alpha.multipleComparison.minP?.toFixed(4)} (${alpha.multipleComparison.minPLabel})`);
console.error(`SIGNAL ALPHA -> ${av.verdict}`);
if (gv) {
  console.error(`gate: ${gv.n_blocks} blocks | basis=${gv.basis_used}${gv.coverage_warning ? ' (WARN coverage<90%)' : ''}`);
  console.error(`  firing-pool: gate ${gv.firing_pool.gate_mean}% vs random ${gv.firing_pool.random_mean}% -> ${gv.firing_pool.percentile}%ile`);
  console.error(`GATE SELECTIVITY -> ${gv.verdict}`);
}
console.error(`\nNOTE: ${out.disclaimer}`);

// ---- machine-readable verdict ----
const json = JSON.stringify(out, null, 2);
if (typeof opts.json === 'string') {
  const fs = await import('fs');
  fs.writeFileSync(opts.json, json);
  console.error(`\nwrote ${opts.json}`);
} else {
  console.log(json);
}
