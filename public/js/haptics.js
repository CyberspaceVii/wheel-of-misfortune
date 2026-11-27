// Vibration, on devices that have it (Android browsers and the Android app; iPhones and
// desktops don't, and then every call here does nothing). Follows settings.haptics.
//
// A felt click for each pin that passes the flapper, in step with audio.tick(): the faster
// the wheel, the lighter the click, so the last slow pins land heavy. A knock when it settles,
// and a racing heartbeat when it lands on a rare slot (see audio.heartbeat()).

export const can = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const settings = { haptics: true };

let lastPin = 0;

const buzz = (p) => {
  if (!can || !settings.haptics) return;
  try { navigator.vibrate(p); } catch {}
};

// A pin through the flapper. speed in rad/s, as for audio.tick().
export function pin(speed = 5) {
  const now = performance.now();
  // phone motors smear anything faster than ~18 a second into one buzz; the sound keeps every pin
  if (now - lastPin < 55) return;
  lastPin = now;
  buzz(speed > 10 ? 6 : speed > 4 ? 10 : 16);
}

// The wheel settling.
export const thud = () => buzz(40);

// Lub-dub, `beats` times at `bpm`: the same rhythm audio.heartbeat() plays.
export function heartbeat(beats, bpm) {
  const period = 60000 / bpm;
  const p = [];
  for (let i = 0; i < beats; i++) p.push(45, 115, 30, Math.max(0, Math.round(period - 190)));
  p.pop(); // no trailing pause
  buzz(p);
}

export const stop = () => { if (can) try { navigator.vibrate(0); } catch {} };
