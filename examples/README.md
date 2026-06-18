# examples

Each example is a self-contained input (+ optional decision log) and the output
touchstone produces from it — a reproducible usage record: a judge runs the command
and gets the same verdict file.

## perceptrade-frz (subject #1)

The author's funding-rate-z-score strategy — the tool's first victim.

- `input.json` — price/signal snapshots from the live VPS run (~10 days)
- `decisions.json` — the council's blocked-trade shadow log
- `output.json` — verdict (NO_EDGE / gate NOT_SELECTIVE)
- `selfcheck.json` — leak-injection self-validation (OVERALL PASS, first SURVIVES at alpha=0.35)

```bash
node ../../src/index.mjs input.json --map price=btcPrice signal=frZ \
  --gate decisions.json --json output.json
node ../../src/index.mjs input.json --map price=btcPrice signal=frZ \
  --selfcheck --json selfcheck.json
```

## synthetic-leak (positive control)

A signal built from a planted future-return leak — shows the harness detects real edge
(expected: SURVIVES). Demonstrates the tool is not trivially always-NO_EDGE. Uses the
default `timestamp` / `price` / `signal` field names, so no `--map` is needed.

```bash
node ../../src/index.mjs input.json --json output.json
```

## random-walk-null (null control)

A seeded pure random walk with an independent gaussian signal — no edge to find by
construction (expected: NO_EDGE). The companion to synthetic-leak: where synthetic-leak
proves the harness *detects* a planted edge, this proves it does not *invent* one. Uses
default field names; reproducible from the same seed.

```bash
node ../../src/index.mjs input.json --json output.json
```

## rsi-mean-reversion (classic indicator)

RSI(14) computed from the same BTC price series, standardized and tested. The result on
this window is NO_EDGE: the overbought→fade / oversold→bounce direction is present but
small and does not survive multiple-comparison correction. A widely-trusted classic
indicator failing the gauntlet is the point — touchstone does not rubber-stamp familiar
signals. Verdict reported as run; no threshold was tuned to manufacture a result.

```bash
node ../../src/index.mjs input.json --standardize --json output.json
```

## llm-council (decision-layer audit)

The Gate Selectivity Test applied to a decision layer, against the perceptrade-frz price
series. Two cases:

- **real LLM council** — the actual Architect/Auditor/Arbiter block log at
  `../perceptrade-frz/decisions.json`. Verdict: **NOT_SELECTIVE** — its blocks are
  statistically indistinguishable from random selection within the firing population.
- **oracle gate (positive control)** — `oracle-blocks.json`, a synthetic gate that blocks
  the worst-realized-PnL firings by construction. Verdict: **SELECTIVE** (0th percentile).
  The gate-axis analogue of synthetic-leak: it proves GST detects a gate that really
  discriminates, so NOT_SELECTIVE on the real council is a finding, not a blind spot.

```bash
# real council -> NOT_SELECTIVE
node ../../src/index.mjs ../perceptrade-frz/input.json --map price=btcPrice signal=frZ \
  --gate ../perceptrade-frz/decisions.json
# oracle positive control -> SELECTIVE
node ../../src/index.mjs ../perceptrade-frz/input.json --map price=btcPrice signal=frZ \
  --gate oracle-blocks.json --json oracle-output.json
```
