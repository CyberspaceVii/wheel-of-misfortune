// The LED timer: a tool for the players; the game never touches it.
//
//   + / -   add or take a minute. Held down, the step grows the longer it is
//           held: 1 → 5 → 15 → 30 → 60 minutes, snapping to that step.
//   play    start / pause. Counts down from the set time, or, set to zero,
//           counts up as a stopwatch.
//   stop    back to the set time.
//   reset   back to 00:00:00.
// At zero: klaxon plus red blink until stop or reset.

const MAX = (99 * 3600 + 59 * 60 + 59) * 1000;
const MIN = 60000;
const STEPS = [1, 5, 15, 30, 60];   // minutes
const STEP_EVERY = 2000;            // ms of holding before the step grows
const FIRST_REPEAT = 420;
const REPEAT = 220;

// 7-segment digit: segments a..g on a 40x70 box
const SEGS = {
  a: '6,2 34,2 29,7 11,7', b: '35,3 38,6 38,33 35,35 31,31 31,8', c: '35,37 38,39 38,64 35,67 31,62 31,40',
  d: '6,68 34,68 29,63 11,63', e: '5,37 9,40 9,62 5,67 2,64 2,39', f: '5,3 9,8 9,31 5,35 2,33 2,6',
  g: '7,35 11,31 29,31 33,35 29,39 11,39',
};
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

function digitSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 70');
  svg.setAttribute('class', 'dg');
  for (const [k, pts] of Object.entries(SEGS)) {
    const p = document.createElementNS(ns, 'polygon');
    p.setAttribute('points', pts);
    p.dataset.s = k;
    svg.append(p);
  }
  return svg;
}

export function initTimer(root, { klaxon }) {
  const led = root.querySelector('.led');
  const stepTag = root.querySelector('.step');
  const btn = (k) => root.querySelector(`[data-t="${k}"]`);
  const digits = [];
  led.replaceChildren();
  for (let i = 0; i < 6; i++) {
    if (i === 2 || i === 4) {
      const c = document.createElement('span');
      c.className = 'colon';
      led.append(c);
    }
    const d = digitSvg();
    digits.push([...d.querySelectorAll('polygon')]);
    led.append(d);
  }

  let setMs = 0;          // the time dialled in
  let value = 0;          // shown when not running (remaining or elapsed)
  let running = false;
  let startedAt = 0;      // performance.now() at (re)start
  let base = 0;           // value at (re)start
  let alarm = false;
  let iv = null;

  const mode = () => (setMs > 0 ? 'down' : 'up');
  const now = () => {
    if (!running) return value;
    const dt = performance.now() - startedAt;
    return mode() === 'down' ? Math.max(0, base - dt) : Math.min(MAX, base + dt);
  };

  function render() {
    const ms = now();
    const sec = mode() === 'down' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const str = [h, m, s].map((x) => String(x).padStart(2, '0')).join('');
    for (let i = 0; i < 6; i++) {
      const on = DIGITS[+str[i]];
      for (const p of digits[i]) p.classList.toggle('on', on.includes(p.dataset.s));
    }
    root.classList.toggle('running', running);
    root.classList.toggle('alarm', alarm);
    root.classList.toggle('stopwatch', mode() === 'up');
    const play = btn('play');
    play.setAttribute('aria-label', running ? 'Pause' : 'Start');
    play.classList.toggle('is-pause', running);
    const lockAdjust = running && mode() === 'up';
    btn('plus').disabled = lockAdjust;
    btn('minus').disabled = lockAdjust || (!running && value === 0);
    led.setAttribute('aria-label', `${h} hours ${m} minutes ${s} seconds`);
  }

  function loop() {
    if (running && mode() === 'down' && now() <= 0) {
      running = false;
      value = 0;
      alarm = true;
      klaxon(true);
      navigator.vibrate?.([400, 200, 400, 200, 400]);
    }
    render();
  }

  function setTicking(on) {
    clearInterval(iv);
    iv = on ? setInterval(loop, 100) : null;
  }

  function silence() {
    if (alarm) { alarm = false; klaxon(false); }
  }

  function adjust(dir, stepMin) {
    silence();
    const step = stepMin * MIN;
    let v = now();
    v = dir > 0 ? (Math.floor(v / step) + 1) * step : (Math.ceil(v / step) - 1) * step;
    v = Math.max(0, Math.min(MAX, v));
    if (running) {
      if (mode() === 'up') return;
      if (v <= 0) return; // don't fire the alarm by turning the dial down
      base = v;
      startedAt = performance.now();
      setMs = Math.max(setMs, v);
    } else {
      value = v;
      setMs = v;
    }
    render();
  }

  // hold-to-accelerate
  let hold = null;
  function holdStart(dir) {
    holdEnd();
    const t0 = performance.now();
    const stepNow = () => STEPS[Math.min(STEPS.length - 1, Math.floor((performance.now() - t0) / STEP_EVERY))];
    const fire = () => {
      const st = stepNow();
      adjust(dir, st);
      stepTag.textContent = `${dir > 0 ? '+' : '−'}${st >= 60 ? '1h' : st + 'm'}`;
      stepTag.classList.toggle('show', st > 1);
    };
    fire();
    hold = { to: setTimeout(function rep() { fire(); hold.to = setTimeout(rep, REPEAT); }, FIRST_REPEAT) };
  }
  function holdEnd() {
    if (!hold) return;
    clearTimeout(hold.to);
    hold = null;
    stepTag.classList.remove('show');
  }

  for (const [k, dir] of [['plus', 1], ['minus', -1]]) {
    const b = btn(k);
    b.addEventListener('pointerdown', (e) => {
      if (b.disabled || e.button > 0) return;
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      holdStart(dir);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, holdEnd);
    b.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menu on touch
    // keyboard: Enter/Space held auto-repeats keydown; treat it as a hold
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) holdStart(dir);
    });
    b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') holdEnd(); });
  }

  btn('play').addEventListener('click', () => {
    if (alarm) return silence(), render();
    if (running) {
      value = now();
      running = false;
      setTicking(false);
    } else {
      base = value;
      startedAt = performance.now();
      running = true;
      setTicking(true);
    }
    render();
  });

  btn('stop').addEventListener('click', () => {
    silence();
    running = false;
    setTicking(false);
    value = setMs;
    render();
  });

  btn('reset').addEventListener('click', () => {
    silence();
    running = false;
    setTicking(false);
    value = setMs = 0;
    render();
  });

  // mouse users: don't leave focus on a timer button, or Space would press it instead of spinning
  root.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') e.target.closest('button')?.blur(); });

  render();
  return {
    isRunning: () => running || alarm,
    // closing the panel ends the timer: silence, stop, back to zero
    terminate() {
      silence();
      running = false;
      setTicking(false);
      value = setMs = 0;
      render();
    },
  };
}
