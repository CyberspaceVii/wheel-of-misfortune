// Per-viewer settings (sound effects, music, voice), kept in localStorage.

const KEY = 'wom.settings';
const DEFAULTS = { sound: true, music: true, voice: true };

let state = { ...DEFAULTS };
try { state = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch {}

const subs = new Set();

export const get = (k) => state[k];

export function set(k, v) {
  state[k] = !!v;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  for (const fn of subs) fn(k, state[k]);
}

// fn(key, value) on every change, and once per key now
export function watch(fn) {
  subs.add(fn);
  for (const k of Object.keys(state)) fn(k, state[k]);
}
