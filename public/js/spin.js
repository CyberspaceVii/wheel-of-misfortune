// Spin choreography. Pure math, no DOM, so it can be tested in node.
//
// The outcome is decided before the wheel moves (weighted RNG, see rng.js).
// This module only scripts HOW the wheel gets there: a spin-up, a long
// ease-out over at least one full turn.
//
// Geometry: wedge i covers wheel-local angles [i*s, (i+1)*s), s = TAU/n,
// drawn at canvas angle rotation + local (clockwise, y down). The pointer
// sits at canvas angle -PI/2 (12 o'clock).
//
// Motion is planned in "travel" x >= 0 along the spin direction:
//   rotation = rotation0 + dir * x
// and q in [0,1) is how far the pointer has crossed the current wedge,
// 0 at the pin it entered by, 1 at the pin it leaves by.

import { rand, randRange, pickKey } from './rng.js';

export const TAU = Math.PI * 2;
export const POINTER = -Math.PI / 2;

// How often each kind of landing happens.
export const DRAMA = {
  normal: 0.8,    // clean stop somewhere inside the wedge
  close: 0.2,     // stops a hair inside an edge, no extra motion
};

const mod = (a, n) => ((a % n) + n) % n;
const smooth = (x) => x * x * (3 - 2 * x);

// Continuous pointer position in wedge units, [0, n).
export function pointerPos(rotation, n) {
  return mod(POINTER - rotation, TAU) / (TAU / n);
}

export function indexAt(rotation, n) {
  return Math.floor(pointerPos(rotation, n)) % n;
}

// Fraction of the current wedge crossed when moving in direction dir.
export function travelFrac(rotation, n, dir) {
  const f = pointerPos(rotation, n) % 1;
  return dir > 0 ? 1 - f : f;
}

// Normalised displacement curve F(u), u in [0,1]: a smoothstep spin-up to
// peak speed by u=a, then speed decays as ((1-u)/(1-a))^p down to zero.
function displacementCurve(a, p, steps = 1024) {
  const v = (u) => (u < a ? smooth(u / a) : Math.pow((1 - u) / (1 - a), p));
  const F = new Float64Array(steps + 1);
  let acc = 0;
  for (let i = 1; i <= steps; i++) {
    acc += (v((i - 1) / steps) + v(i / steps)) / (2 * steps);
    F[i] = acc;
  }
  for (let i = 1; i <= steps; i++) F[i] /= acc;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    const x = u * steps;
    const i = Math.floor(x);
    return F[i] + (F[i + 1] - F[i]) * (x - i);
  };
}

// Segment builders. Each returns { dur, kind, at(t) -> travel }.
function mainSeg(x0, x1, dur, a, p) {
  const F = displacementCurve(a, p);
  return { dur, kind: 'spin', at: (t) => x0 + (x1 - x0) * F(t / dur) };
}

/**
 * Plan a spin.
 * @param {object} o
 *   rotation0  current wheel rotation (radians)
 *   n          wedge count
 *   target     wedge index the RNG already picked
 *   dir        +1 clockwise, -1 counter-clockwise
 *   strength   0..1 (flick speed, or random for button/space)
 *   flick      true when launched by a flick (already moving: short spin-up)
 *   drama      force a DRAMA kind (tests); otherwise random
 */
export function planSpin({ rotation0, n, target, dir = 1, strength = 0.5, flick = false, drama, r = rand }) {
  const s = TAU / n;
  const kind = drama || pickKey(DRAMA, r());
  const rr = (lo, hi) => lo + (hi - lo) * r();

  // Rotation at which the pointer sits on the target wedge's entry pin.
  const entry = dir > 0 ? POINTER - (target + 1) * s : POINTER - target * s;
  const base = mod(dir * (entry - rotation0), TAU); // travel to reach that pin

  // where in the target wedge it stops (fraction of the wedge past its entry pin)
  const q = kind === 'close' ? (r() < 0.5 ? rr(0.03, 0.09) : rr(0.91, 0.97)) : rr(0.18, 0.82);

  // At least one full turn always; normally several.
  const minTurns = flick ? 1.5 + 3 * strength : 2.5 + 3 * strength + r();
  let xMain = base + q * s;
  while (xMain < minTurns * TAU) xMain += TAU;

  const dur = (flick ? 4.5 : 5.5) + 3.5 * strength + rr(-0.4, 0.6);
  const segs = [mainSeg(0, xMain, dur, flick ? 0.015 : rr(0.08, 0.12), rr(2.4, 3.0))];
  const xFinal = xMain;

  const total = segs.reduce((a, g) => a + g.dur, 0);
  const finalRotation = rotation0 + dir * xFinal;

  // Sample the timeline at t seconds since launch.
  function at(t) {
    if (t >= total) return { rotation: finalRotation, phase: 'done', done: true };
    let t0 = 0;
    for (const g of segs) {
      if (t < t0 + g.dur) return { rotation: rotation0 + dir * g.at(t - t0), phase: g.kind, done: false };
      t0 += g.dur;
    }
    return { rotation: finalRotation, phase: 'done', done: true };
  }

  return { kind, target, dir, n, duration: total, finalRotation, at };
}

export { randRange };

// Flapper + pin bookkeeping, advanced once per frame. Kept here (no DOM) so
// it can be simulated at any frame rate in node.
export const FLAP_MAX = 0.55; // radians

export class Flapper {
  constructor(rotation, n) {
    this.reset(rotation, n);
  }

  reset(rotation, n) {
    this.n = n;
    this.s = TAU / n;
    this.prevRot = rotation;
    this.prevPin = Math.floor((POINTER - rotation) / this.s);
    this.dir = 1;
    this.speed = 0;
    this.angle = 0;
    this.vel = 0;
  }

  // Returns the number of pins crossed this frame (for tick sounds).
  update(rotation, dt) {
    const dRot = rotation - this.prevRot;
    this.prevRot = rotation;
    this.speed = this.speed * 0.7 + (Math.abs(dRot) / dt) * 0.3;
    if (Math.abs(dRot) > 1e-5) this.dir = Math.sign(dRot);

    const pin = Math.floor((POINTER - rotation) / this.s);
    const crossed = Math.abs(pin - this.prevPin);
    this.prevPin = pin;

    // pushed by the approaching pin, springs back once it slips past
    const q = travelFrac(rotation, this.n, this.dir);
    const C = 0.22;
    const push = q > 1 - C ? FLAP_MAX * smooth((q - (1 - C)) / C) : 0;
    const target = -this.dir * push; // tip leans the way the rim travels
    const a = this.angle;
    if (Math.abs(target) >= Math.abs(a) && Math.sign(target || a) === Math.sign(a || target)) {
      this.angle = target;
      this.vel = 0;
    } else {
      // fixed 1/240 s substeps: a frame-sized step overshoots when frames drop
      for (let k = Math.ceil(dt * 240), h = dt / k; k > 0; k--) {
        this.vel += ((target - this.angle) * 900 - this.vel * 22) * h;
        this.angle += this.vel * h;
      }
      this.angle = Math.max(-FLAP_MAX, Math.min(FLAP_MAX, this.angle));
    }
    return crossed;
  }
}
