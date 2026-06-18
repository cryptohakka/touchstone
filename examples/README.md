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
