// test/smoke.test.mjs — node --test
// Asserts the harness has both halves of honesty: it clears noise and catches
// leaks. Deterministic (seeded) so results are reproducible.
import { test } from 'node:test';
import assert from 'node:assert';
import { inferCadence } from '../src/adapter.mjs';
import { runAlpha } from '../src/engine.mjs';
import { runSelfCheck } from '../src/selfcheck.mjs';

const N = 2000, start = Date.parse('2026-06-06T00:00:00Z'), step = 5 * 60 * 1000, SPH = 12, H = 24;

// seeded PRNG + Box-Muller for reproducible synthetic data
function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeGauss(seed){ const r = mulberry32(seed); return () => { let u=0,v=0; while(!u)u=r(); while(!v)v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }; }

function noise(seed = 7) {
  const g = makeGauss(seed); let p = 66000; const s = [];
  for (let i = 0; i < N; i++) { p *= 1 + g() * 0.0008; s.push({ t: start + i * step, p, z: g() }); }
  return s;
}
function leak(seed = 7) {
  const g = makeGauss(seed); let p = 66000; const px = [];
  for (let i = 0; i < N; i++) { p *= 1 + g() * 0.0008; px.push(p); }
  const s = [];
  for (let i = 0; i < N; i++) { const j = i + H * SPH; const z = j < N ? ((px[j] - px[i]) / px[i]) / 0.012 : g(); s.push({ t: start + i * step, p: px[i], z }); }
  return s;
}

test('cadence inference recovers sph=12 on 5-min bars', () => {
  assert.strictEqual(inferCadence(noise()).sph, 12);
});

test('pure noise -> NO_EDGE (no false positives survive BH)', () => {
  assert.strictEqual(runAlpha(noise(), { sph: SPH }).multipleComparison.bhRejected.length, 0);
});

test('planted future-return leak -> SURVIVES (detection power exists)', () => {
  assert.ok(runAlpha(leak(), { sph: SPH }).multipleComparison.bhRejected.length > 0);
});

test('self-check on noise: detection curve rises, both nulls pass', () => {
  const sc = runSelfCheck(noise(), { sph: SPH });
  assert.strictEqual(sc.baseline_signal.verdict, 'NO_EDGE');
  assert.ok(sc.summary.detection_power, 'leak injection should flip verdict to SURVIVES with decreasing min_p');
  assert.ok(sc.summary.no_false_positive, 'shuffle null should stay NO_EDGE');
  assert.ok(sc.summary.direction_invariant, 'sign-flip should leave min_p unchanged');
  assert.strictEqual(sc.detection_power.first_survive_alpha, 0.2, 'documented synthetic leak-detection point');
});
