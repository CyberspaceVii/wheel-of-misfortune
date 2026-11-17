// node tools/test-spin.mjs — checks the spin planner and the weighted RNG.
import { planSpin, indexAt, travelFrac, TAU, DRAMA, Flapper, FLAP_MAX } from '../public/js/spin.js';
import { weightedIndex, rand } from '../public/js/rng.js';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.error('FAIL', msg); } };

// 1. Every plan lands on its target, turns at least once, never wanders
//    through the target's far pin, and ends motionless.
const kinds = Object.keys(DRAMA);
for (let trial = 0; trial < 20000; trial++) {
  const n = 8 + 2 * Math.floor(rand() * 9);          // 8..24, even
  const target = Math.floor(rand() * n);
  const dir = rand() < 0.85 ? 1 : -1;
  const rotation0 = (rand() - 0.5) * 40;
  const flick = rand() < 0.5;
  const drama = kinds[trial % kinds.length];
  const p = planSpin({ rotation0, n, target, dir, strength: rand(), flick, drama });

  const end = p.at(p.duration + 1);
  check(end.done && indexAt(end.rotation, n) === target, `land n=${n} t=${target} ${drama}`);
  check(Math.abs(p.finalRotation - rotation0) >= TAU, `turn ${drama}`);
  // continuity: sampled end of timeline vs final
  const near = p.at(p.duration - 1e-4).rotation;
  check(Math.abs(near - p.finalRotation) < (TAU / n) * 0.02, `snap ${drama} ${near - p.finalRotation}`);

  // after the main spin, the pointer must not leave the target (no fake-outs)
  let crossings = 0, prev = null;
  for (let t = 0; t <= p.duration; t += 1 / 240) {
    const st = p.at(t);
    if (st.phase === 'spin') continue;
    const idx = indexAt(st.rotation, n);
    if (prev !== null && idx !== prev) crossings++;
    prev = idx;
  }
  check(crossings === 0, `fakeout crossings ${drama}=${crossings}`);
  const q = travelFrac(p.finalRotation, n, dir);
  check(q > 0.01 && q < 0.99, `final q ${drama} ${q}`);
}

// 2. Weighted RNG matches the weights (chi-square-ish tolerance).
const items = [1, 2, 5, 10, 10, 3].map((weight) => ({ weight }));
const total = items.reduce((a, b) => a + b.weight, 0);
const counts = new Array(items.length).fill(0);
const N = 400000;
for (let i = 0; i < N; i++) counts[weightedIndex(items)]++;
items.forEach((it, i) => {
  const exp = (it.weight / total) * N;
  check(Math.abs(counts[i] - exp) < 5 * Math.sqrt(exp), `weight ${it.weight}: ${counts[i]} vs ${exp.toFixed(0)}`);
});

// 2b. Flapper at 60/30/15 fps: finite, bounded, and every pin crossing counted.
for (const fps of [60, 30, 15]) {
  for (const drama of kinds) {
    for (let k = 0; k < 200; k++) {
      const n = 12, rotation0 = rand() * 10;
      const p = planSpin({ rotation0, n, target: k % n, strength: rand(), drama });
      const f = new Flapper(rotation0, n);
      let ticks = 0, maxA = 0;
      const dt = 1 / fps;
      for (let t = 0; t <= p.duration + 0.5; t += dt) {
        ticks += f.update(p.at(t).rotation, dt);
        if (!Number.isFinite(f.angle)) { check(false, `flap NaN ${fps} ${drama}`); break; }
        maxA = Math.max(maxA, Math.abs(f.angle));
      }
      const s = TAU / n;
      const pins = Math.abs(Math.floor((-Math.PI / 2 - p.finalRotation) / s) - Math.floor((-Math.PI / 2 - rotation0) / s));
      check(maxA <= FLAP_MAX + 1e-9, `flap bound ${fps} ${drama} ${maxA}`);
      // never fewer ticks than pins crossed
      check(ticks >= pins, `ticks ${fps} ${drama} ${ticks} < ${pins}`);
    }
  }
}

// 3. Drama mix.
const mix = Object.fromEntries(kinds.map((k) => [k, 0]));
for (let i = 0; i < 50000; i++) mix[planSpin({ rotation0: 0, n: 12, target: 3 }).kind]++;
console.log('drama mix', Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, (v / 500).toFixed(1) + '%'])));
console.log('weights', counts.map((c) => (c / N * 100).toFixed(2) + '%').join(' '));
console.log(fail ? `${fail} failures` : 'all spin/rng checks passed');
process.exit(fail ? 1 : 0);
