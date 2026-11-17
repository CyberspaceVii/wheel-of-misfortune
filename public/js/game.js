// Game screen: wheel, spin, result, log. main.js hands it a wheel and the
// players; the frame loop only runs while the screen is showing.

import { WheelView } from './wheel.js';
import { planSpin, indexAt, Flapper, TAU, POINTER } from './spin.js';
import { weightedIndex, randRange, rand } from './rng.js';
import * as audio from './audio.js';
import * as music from './music.js';
import { $, el, nm, fillInto, confirmBox } from './ui.js';
import { media } from './api.js';

const root = document.documentElement;

let players = { giver: 'Player One', receiver: 'Player Two' };
let wheel = null;
let n = 1;
let s = TAU;

const view = new WheelView($('#wheel'));
const wrap = $('.wheel-wrap');
new ResizeObserver(() => { if (wrap.clientWidth) view.resize(wrap.clientWidth); }).observe(wrap);

// ---- motion state ----
let rotation = 0;
let flapper = new Flapper(0, 1);
let plan = null;
let t0 = 0;
let phase = 'idle';
let drag = null;
let active = false;
let raf = 0;

// lights
let winIndex = null;
let landedAt = 0;

// ---- log ----
const LOG_KEY = 'wom.log';
let log = [];
try { log = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { log = []; }
const saveLog = () => { try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 300))); } catch {} };

export function setPlayers(p) { players = { ...p }; }

export function setWheel(w) {
  wheel = w;
  n = w.items.length;
  s = TAU / n;
  view.setItems(w.items);
  rotation = -s / 2; // wedge 0 under the pointer
  flapper = new Flapper(rotation, n);
  plan = null;
  winIndex = null;
  root.classList.remove('spinning');
  $('#spin').disabled = false;
  $('#game .wheel-name').textContent = w.name;
  const r = $('#result');
  r.disabled = true;
  r.querySelector('.kicker').textContent = 'The Promulgator awaits';
  r.querySelector('.name').textContent = 'Spin, if you dare';
  document.fonts?.ready.then(() => { if (wheel === w) view.setItems(w.items); }); // re-letter once the webfonts load
}

export function enter() {
  active = true;
  if (wrap.clientWidth) view.resize(wrap.clientWidth);
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

export function leave() {
  active = false;
  cancelAnimationFrame(raf);
  seq?.abort();
  audio.stopSound();
}

export const busy = () => !!plan;

// ---- spin ----
const SPIN_LINES = [
  'Round and round she goes…',
  'Fate is being consulted.',
  'No refunds.',
  'The house always wins.',
  'Brace yourselves.',
  'The Promulgator hungers.',
  'The decree is in motion.',
  'Nobody leaves early.',
];

let seq = null; // AbortController for the post-landing sound/voice sequence

export function spin({ flick = false, dir = 1, strength, drama } = {}) {
  if (plan || !wheel || !active) return;
  audio.unlock();
  seq?.abort();
  audio.stopSound();
  const target = weightedIndex(wheel.items);
  plan = planSpin({ rotation0: rotation, n, target, dir, strength: strength ?? randRange(0.35, 0.9), flick, drama });
  t0 = performance.now();
  winIndex = null;
  root.classList.add('spinning');
  $('#spin').disabled = true;
  const r = $('#result');
  r.disabled = true;
  fillInto(r.querySelector('.kicker'), SPIN_LINES[Math.floor(rand() * SPIN_LINES.length)], players);
  r.querySelector('.name').textContent = '· · ·';
}

function land() {
  const target = plan.target;
  // fold the accumulated turns away; keep pin bookkeeping consistent
  rotation = ((plan.finalRotation % TAU) + TAU) % TAU;
  flapper.prevRot = rotation;
  flapper.prevPin = Math.floor((POINTER - rotation) / s);
  plan = null;
  if (indexAt(rotation, n) !== target) console.error('wom: landed off-target', target, indexAt(rotation, n));

  winIndex = target;
  landedAt = performance.now();
  root.classList.remove('spinning');
  $('#spin').disabled = false;
  audio.thud();

  const item = wheel.items[target];
  const entry = { n: (log[0]?.n || 0) + 1, at: Date.now(), wheel: wheel.name, giver: players.giver, receiver: players.receiver, item };
  log.unshift(entry);
  saveLog();
  renderLogBadge();
  showResult(entry);
  runSequence(item);
}

const wait = (ms, sig) =>
  new Promise((res) => {
    const id = setTimeout(res, ms);
    sig.addEventListener('abort', () => { clearTimeout(id); res(); }, { once: true });
  });

// land → 1–2 s → slot sound (if any, to its end) → 1 s → voice
async function runSequence(item) {
  seq = new AbortController();
  const sig = seq.signal;
  music.duck(true);
  sig.addEventListener('abort', () => music.duck(false), { once: true });
  await wait(randRange(1000, 2000), sig);
  if (sig.aborted) return;
  await audio.playSound(media(item.sound), sig);
  if (sig.aborted) return;
  await wait(1000, sig);
  if (sig.aborted) return;
  await audio.speak(item.label, sig, item.voice);
  if (!sig.aborted) setTimeout(() => music.duck(false), 600);
}

// ---- result plaque + dialogs ----
function showResult(entry) {
  const r = $('#result');
  r.disabled = false;
  fillInto(r.querySelector('.kicker'), 'The Promulgator has decreed', entry);
  r.querySelector('.name').textContent = entry.item.label;
  r.onclick = () => openItem(entry);
}

function openItem(entry) {
  const d = $('#item-dlg');
  const p = { giver: entry.giver, receiver: entry.receiver };
  fillInto(d.querySelector('.who'), '@Player1 & @Player2', p);
  d.querySelector('h2').textContent = entry.item.label;
  fillInto(d.querySelector('.desc'), entry.item.description || 'The Promulgator offers no explanation.', p);
  const img = d.querySelector('img');
  const src = media(entry.item.image);
  if (src) {
    img.src = src;
    img.alt = entry.item.label;
    img.hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
  }
  if ($('#log-dlg').open) $('#log-dlg').close();
  d.showModal();
}

const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function renderLogBadge() {
  const b = $('#log-btn .badge');
  b.textContent = log.length;
  b.hidden = !log.length;
}

function openLog() {
  const ul = $('#log-dlg ol');
  ul.replaceChildren();
  if (!log.length) ul.append(el('li', { class: 'empty', text: 'Nothing yet. The Wheel is patient.' }));
  for (const e of log) {
    ul.append(el('li', {},
      el('button', { type: 'button', onclick: () => openItem(e) },
        el('span', { class: 'no', text: `#${e.n}` }),
        el('span', { class: 'what', text: e.item.label }),
        el('span', { class: 'meta' }, `${fmtTime(e.at)} · `, nm(e.giver), ' & ', nm(e.receiver), e.wheel ? ` · ${e.wheel}` : null))));
  }
  $('#log-clear').hidden = !log.length;
  $('#log-dlg').showModal();
}

$('#log-btn').onclick = openLog;
$('#log-clear').onclick = async () => {
  if (!(await confirmBox('Erase the record? The Wheel will remember anyway.', { ok: 'Erase it', cancel: 'Keep it', danger: true }))) return;
  log = [];
  saveLog();
  renderLogBadge();
  openLog();
};
renderLogBadge();

// ---- input ----
$('#spin').addEventListener('click', (e) => { e.currentTarget.blur(); spin(); });

const canvas = $('#wheel');
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// flick: drag the wheel round, let go with some speed
canvas.addEventListener('pointerdown', (e) => {
  if (plan || !wheel || !view.hit(e.offsetX, e.offsetY)) return;
  seq?.abort();
  canvas.setPointerCapture(e.pointerId);
  const a = view.angleAt(e.offsetX, e.offsetY);
  drag = { id: e.pointerId, last: a, acc: 0, samples: [{ t: e.timeStamp, acc: 0 }] };
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const a = view.angleAt(e.offsetX, e.offsetY);
  const d = wrapPi(a - drag.last);
  drag.last = a;
  drag.acc += d;
  rotation += d;
  drag.samples.push({ t: e.timeStamp, acc: drag.acc });
  while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 120) drag.samples.shift();
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const first = drag.samples[0];
  const dt = (e.timeStamp - first.t) / 1000;
  const w = dt > 0.008 ? (drag.acc - first.acc) / dt : 0;
  drag = null;
  if (Math.abs(w) > 2.5) spin({ flick: true, dir: Math.sign(w), strength: Math.min(1, (Math.abs(w) - 2.5) / 22) });
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- frame loop ----
let last = performance.now();

function frame(now) {
  if (!active) return;
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;

  if (plan) {
    const st = plan.at((now - t0) / 1000);
    rotation = st.rotation;
    phase = st.phase;
    if (st.done) land();
  } else {
    phase = winIndex != null && now - landedAt < 2600 ? 'win' : 'idle';
  }

  if (flapper.update(rotation, dt)) audio.tick(flapper.speed);

  view.draw({
    rotation,
    flap: flapper.angle,
    win: winIndex,
    winGlow: winIndex == null ? 0 : 0.55 + 0.45 * Math.sin((now - landedAt) / 260),
  });
  raf = requestAnimationFrame(frame);
}

