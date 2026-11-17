// Audio: pin ticks, placeholder stings (synthesised, no files), slot sound
// effects from URLs, and the spoken result.
//
// Browsers only allow audio after a user gesture, so unlock() is called from
// the first pointerdown/keydown.

export const settings = { sound: true, voice: true };

let ctx = null;
let master = null;
let lastTick = 0;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; // texture only, not an outcome
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

// A pin striking the flapper. speed (rad/s) brightens and quietens it a little.
export function tick(speed = 5) {
  if (!ctx || !settings.sound) return;
  const now = ctx.currentTime;
  if (now - lastTick < 0.028) return; // above ~35/s ticks smear into a buzz anyway
  lastTick = now;
  const src = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200 + Math.min(speed, 20) * 60;
  bp.Q.value = 3;
  const g = ctx.createGain();
  const vol = 0.55 - Math.min(speed, 20) * 0.012;
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
  src.connect(bp).connect(g).connect(master);
  src.start(now, Math.random() * 0.5, 0.05);
}

// Soft thud when the wheel settles.
export function thud() {
  if (!ctx || !settings.sound) return;
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(110, now);
  o.frequency.exponentialRampToValueAtTime(45, now + 0.25);
  g.gain.setValueAtTime(0.5, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + 0.4);
}

// Placeholder stings until real uploads exist. Each resolves when it ends.
const synths = {
  gong(now) {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.7, now + 0.02);
    out.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
    out.connect(master);
    [55, 82.4, 110.7, 151.3, 197.6, 263].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      g.gain.value = 0.5 / (i + 1);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + 4.6);
    });
    return 4.6;
  },
  thunder(now) {
    const src = noise();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1.2, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.4, now + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, now + 3.2);
    src.connect(lp).connect(g).connect(master);
    src.start(now);
    src.stop(now + 3.3);
    return 3.3;
  },
  bell(now) {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.5, now);
    out.gain.exponentialRampToValueAtTime(0.001, now + 3.5);
    out.connect(master);
    [[220, 1], [440 * 1.19, 0.5], [660 * 1.33, 0.3], [880 * 1.5, 0.15]].forEach(([f, a]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.value = a;
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + 3.6);
    });
    return 3.6;
  },
};

let currentEl = null;

// Play a slot's sound: "synth:<name>" or a URL. Resolves when it ends
// (capped at 10 s so a long file can't hold up the voice).
export function playSound(ref, signal) {
  return new Promise((resolve) => {
    if (!ref || !settings.sound || !ctx) return resolve();
    const done = () => { clearTimeout(cap); resolve(); };
    const cap = setTimeout(() => { stopSound(); resolve(); }, 10000);
    signal?.addEventListener('abort', () => { stopSound(); done(); }, { once: true });
    if (ref.startsWith('synth:')) {
      const fn = synths[ref.slice(6)];
      if (!fn) return done();
      setTimeout(done, fn(ctx.currentTime) * 1000);
      return;
    }
    const el = new Audio(ref);
    currentEl = el;
    el.addEventListener('ended', done, { once: true });
    el.addEventListener('error', done, { once: true });
    el.play().catch(done);
  });
}

export function stopSound() {
  if (currentEl) { currentEl.pause(); currentEl = null; }
}

// ---- voice -----------------------------------------------------------------
// Slot names are pre-rendered by Piper on the server (item.voice) so every
// device hears the same voice. Until a line is rendered, fall back to browser
// TTS. There is no "gender" field in the Web Speech API, so pick by known
// female voice names.

const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|allison|ava|susan|zira|hazel|libby|sonia|aria|jenny|michelle|emma|natasha|clara|kate|amy|salli|joanna|kimberly|ivy|kendra|nicky|catherine|google uk english female|google us english/i;
const MALE = /\bmale\b|daniel|alex|fred|david|mark|george|ryan|guy|thomas|oliver|arthur|james/i;

let voice = null;
function chooseVoice() {
  const all = window.speechSynthesis?.getVoices() || [];
  const en = all.filter((v) => /^en/i.test(v.lang));
  const pool = en.length ? en : all;
  voice =
    pool.find((v) => FEMALE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, ''))) ||
    pool.find((v) => !MALE.test(v.name)) ||
    pool[0] ||
    null;
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  chooseVoice();
  window.speechSynthesis.addEventListener?.('voiceschanged', chooseVoice);
}

export function speak(text, signal, url) {
  if (url && settings.voice) {
    return new Promise((resolve) => {
      const el = new Audio(url);
      let fellBack = false;
      const fallback = () => { if (fellBack) return; fellBack = true; webSpeech(text, signal).then(resolve); };
      el.addEventListener('ended', () => resolve(), { once: true });
      el.addEventListener('error', fallback, { once: true });
      signal?.addEventListener('abort', () => { el.pause(); resolve(); }, { once: true });
      el.play().catch(fallback);
    });
  }
  return webSpeech(text, signal);
}

function webSpeech(text, signal) {
  return new Promise((resolve) => {
    const ss = window.speechSynthesis;
    if (!ss || !settings.voice || !text) return resolve();
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 0.88;
    u.pitch = 0.8; // a little lower: sultry rather than chirpy
    u.onend = u.onerror = () => resolve();
    signal?.addEventListener('abort', () => { ss.cancel(); resolve(); }, { once: true });
    ss.speak(u);
  });
}

// ---- klaxon (timer at zero) ------------------------------------------------
// A harsh two-tone horn, repeated until stopped. Deliberately ignores the sound
// setting: it's an alarm someone set on purpose.

let klax = null;

export function klaxon(on) {
  if (!on) {
    if (!klax) return;
    const { out, iv } = klax;
    klax = null;
    clearInterval(iv);
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    setTimeout(() => out.disconnect(), 300);
    return;
  }
  unlock();
  if (!ctx || klax) return;
  const out = ctx.createGain();
  out.gain.value = 0.32;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
  shaper.curve = curve;
  shaper.connect(out).connect(ctx.destination);
  let hi = true;
  const honk = () => {
    const now = ctx.currentTime;
    for (const [f, type] of [[hi ? 660 : 494, 'sawtooth'], [hi ? 663 : 497, 'square']]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
      g.gain.setValueAtTime(0.5, now + 0.36);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      o.connect(g).connect(shaper);
      o.start(now);
      o.stop(now + 0.42);
    }
    hi = !hi;
  };
  honk();
  klax = { out, iv: setInterval(honk, 420) };
}
