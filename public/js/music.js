// Background music from music/soundtrack.json:
//   {"opener": "a.mp3", "tracks": ["b.mp3", ...]}   (a bare array = tracks only)
// The opener plays first, once; after it everything (the opener included) is shuffled:
// a track never plays twice until every track has played, and a reshuffle never puts
// the last track first. The only control is mute (settings.music). Nothing plays until
// start() is called (the age gate's Enter, a user gesture); later gestures retry it if the
// browser still blocked it.

import { rand } from './rng.js';

const VOL = 0.38;
const DUCKED = 0.1;
const OK = (t) => typeof t === 'string' && /^[^/\\]+\.(mp3|ogg|oga|opus|m4a|flac|wav)$/i.test(t) && !t.startsWith('.');

let tracks = [];
let bag = [];
let last = null;
let el = null;
let muted = false;
let started = false;   // sound is allowed (play() has succeeded)
let errors = 0;
let ducked = false;
let wanted = false;     // start() has been called

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function next() {
  if (!tracks.length) return null;
  if (!bag.length) {
    bag = shuffle(tracks.slice());
    if (bag.length > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1], bag[0]];
  }
  last = bag.shift();
  return last;
}

function tryPlay() {
  if (muted) return;
  el.play().then(() => { started = true; }).catch(() => {});
}

function play() {
  const t = next();
  if (!t) return;
  el.src = 'music/' + encodeURIComponent(t);
  el.volume = ducked ? DUCKED : VOL;
  tryPlay();
}

export async function init() {
  try {
    const r = await fetch('music/soundtrack.json', { cache: 'no-cache' });
    if (r.ok) {
      const j = await r.json();
      const list = Array.isArray(j) ? j : j.tracks;
      const opener = !Array.isArray(j) && OK(j.opener) ? j.opener : null;
      tracks = (Array.isArray(list) ? list : []).filter((t) => OK(t) && t !== opener);
      if (opener) {
        // the opener first; the rest of the first round shuffled, the opener rejoins after
        bag = [opener, ...shuffle(tracks.slice())];
        tracks.push(opener);
      }
    }
  } catch {}
  el = new Audio();
  el.preload = 'auto';
  el.addEventListener('ended', () => { errors = 0; play(); });
  el.addEventListener('playing', () => { errors = 0; started = true; });
  // a missing or broken file is skipped; give up once every track has failed
  el.addEventListener('error', () => { if (++errors < tracks.length) play(); });
  if (wanted) start();
}

// Called from a user gesture: the gate's Enter, then any later gesture until sound is allowed.
export function start() {
  wanted = true;
  if (!el || started || muted) return;
  if (!el.src) play();
  else tryPlay();
}

export function setMuted(m) {
  muted = !!m;
  if (!el) return;
  if (muted) el.pause();
  else if (!wanted) return;
  else if (!el.src) play();
  else tryPlay();
}

// Quieter while a result's sound and voice play.
export function duck(on) {
  ducked = !!on;
  if (!el) return;
  const from = el.volume;
  const to = ducked ? DUCKED : VOL;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 400);
    el.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

export const hasTracks = () => tracks.length > 0;
