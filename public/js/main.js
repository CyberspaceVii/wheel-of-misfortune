// Boot + screen flow: opening titles → players → the decree (mode +
// wheel) → the game. Settings, music and the timer live here too.

import * as audio from './audio.js';
import * as haptics from './haptics.js';
import * as music from './music.js';
import * as settings from './settings.js';
import * as api from './api.js';
import * as game from './game.js';
import * as scene from './scene.js';
import { playIntro } from './intro.js';
import { initTimer } from './timer.js';
import { initClock } from './clock.js';
import { initEditor, openEditor } from './editor.js';
import { $, el, fillInto, toast } from './ui.js';

const root = document.documentElement;
const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

// ---- device: capability detection, live (rotation, docking, resizing) ----
const coarse = matchMedia('(pointer: coarse)');
function applyDevice() {
  root.classList.toggle('touch', coarse.matches);
  root.classList.toggle('mouse', !coarse.matches);
}
coarse.addEventListener('change', applyDevice);
applyDevice();

// no logo file (yet): the menu falls back to the title in type
const menuLogo = $('.menu-logo');
menuLogo.addEventListener('error', () => menuLogo.classList.add('gone'), { once: true });
if (menuLogo.complete && !menuLogo.naturalWidth) menuLogo.classList.add('gone');

// ---- settings ----
if (!haptics.can) $('[data-set="haptics"]').closest('.tog').hidden = true; // nothing to vibrate
settings.watch((k, v) => {
  if (k === 'sound' || k === 'voice') audio.settings[k] = v;
  if (k === 'haptics') haptics.settings.haptics = v;
  if (k === 'music') {
    music.setMuted(!v);
    for (const b of document.querySelectorAll('.music-btn')) {
      b.classList.toggle('off', !v);
      b.setAttribute('aria-label', v ? 'Mute music' : 'Unmute music');
    }
  }
  const box = document.querySelector(`[data-set="${k}"]`);
  if (box) box.checked = v;
});
for (const box of document.querySelectorAll('[data-set]')) {
  box.addEventListener('change', () => settings.set(box.dataset.set, box.checked));
}
for (const b of document.querySelectorAll('[data-settings]')) b.addEventListener('click', () => $('#settings-dlg').showModal());
for (const b of document.querySelectorAll('.music-btn')) b.addEventListener('click', () => settings.set('music', !settings.get('music')));
// close buttons + click on the smoky backdrop (the editor handles its own)
for (const d of document.querySelectorAll('dialog:not(#editor-dlg)')) {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}

// first gesture anywhere: audio may start
let entered = false; // past the age gate
const gesture = () => { audio.unlock(); if (entered) music.start(); };
document.addEventListener('pointerdown', gesture, { capture: true });
document.addEventListener('keydown', gesture, { capture: true });
music.init();

// ---- screens ----
let screen = 'intro';

function show(name) {
  if (name === screen) return;
  const from = $(`#${screen}`);
  const to = $(`#${name}`);
  if (screen === 'game') game.leave();
  from.classList.remove('in');
  setTimeout(() => { from.hidden = true; }, screen === 'intro' ? 900 : 500); // the intro's logo outlasts the menu's fade-in
  to.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => to.classList.add('in')));
  screen = name;
  root.dataset.screen = name;
  if (name === 'game') game.enter();
  if (name === 'setup') loadWheels();
  wake(name === 'game');
  // focus the first useful thing for keyboard users
  setTimeout(() => {
    if (name === 'names') ($('#giver').value ? $('#names-form .spin-btn') : $('#giver')).focus({ preventScroll: true });
  }, 520);
}

for (const b of document.querySelectorAll('[data-go]')) {
  b.addEventListener('click', () => {
    if (screen === 'game' && game.busy()) return toast('Not while the Wheel is turning');
    show(b.dataset.go);
  });
}

// ---- players ----
const PLAYERS_KEY = 'wom.players';
let players = { giver: '', receiver: '' };
try { players = { ...players, ...JSON.parse(localStorage.getItem(PLAYERS_KEY)) }; } catch {}
// Player 1's name always starts with a capital, Player 2's with a small letter
const caseFirst = { giver: (c) => c.toUpperCase(), receiver: (c) => c.toLowerCase() };
const firstCased = (who, s) => s.replace(/^\s*\S/, caseFirst[who]);
for (const who of ['giver', 'receiver']) {
  const f = $('#' + who);
  f.value = firstCased(who, players[who]);
  f.addEventListener('input', () => {
    const v = firstCased(who, f.value);
    if (v === f.value) return;
    const at = f.selectionStart;
    f.value = v;
    f.setSelectionRange(at, at);
  });
}

const clean = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 24);

$('#names-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const g = firstCased('giver', clean($('#giver').value));
  const r = firstCased('receiver', clean($('#receiver').value));
  if (!g || !r) return;
  if (g.toLowerCase() === r.toLowerCase()) {
    toast('Two different people, please. The Wheel can count.');
    $('#receiver').focus();
    return;
  }
  players = { giver: g, receiver: r };
  try { localStorage.setItem(PLAYERS_KEY, JSON.stringify(players)); } catch {}
  game.setPlayers(players);
  for (const x of document.querySelectorAll('.p-giver')) x.textContent = g;
  for (const x of document.querySelectorAll('.p-receiver')) x.textContent = r;
  show('setup');
});

// ---- setup: wheel picker ----
const WHEEL_KEY = 'wom.wheel';
let chosen = null;
try { chosen = localStorage.getItem(WHEEL_KEY); } catch {}
let loading = null;

async function loadWheels() {
  const list = $('#wheel-list');
  const run = (loading = Symbol());
  let wheels;
  try {
    wheels = await api.listWheels();
  } catch (e) {
    if (run !== loading) return;
    list.replaceChildren(el('p', { class: 'wait error', text: `The Wheel cannot be reached: ${e.message}` }));
    $('#begin').disabled = true;
    return;
  }
  if (run !== loading) return;
  const playable = wheels.filter((w) => w.count >= 2);
  if (!playable.some((w) => w.id === chosen)) chosen = playable[0]?.id ?? null;
  list.replaceChildren(...(wheels.length ? wheels.map((w) =>
    el('label', { class: `wheel-opt${w.count < 2 ? ' unplayable' : ''}` },
      el('input', { type: 'radio', name: 'wheel', value: w.id, checked: w.id === chosen, disabled: w.count < 2, onchange: () => pick(w.id) }),
      el('span', { class: 'wheel-card' },
        el('span', { class: 'wheel-title', text: w.name }),
        w.description ? fillInto(el('span', { class: 'wheel-desc' }), w.description, players) : el('span', { class: 'wheel-desc', text: ' ' }),
        el('span', { class: 'wheel-count', text: w.count < 2 ? 'needs at least two slots' : `${w.count} slots` }))))
    : [el('p', { class: 'wait', text: 'No wheels yet. Open the workshop (the quill, top right) and build one.' })]),
  el('button', { type: 'button', class: 'ghost workshop-link', text: 'Edit wheels in the workshop', onclick: () => openEditor() }));
  $('#begin').disabled = !chosen;
}

function pick(id) {
  chosen = id;
  try { localStorage.setItem(WHEEL_KEY, id); } catch {}
  $('#begin').disabled = false;
}

$('#begin').addEventListener('click', async () => {
  if (!chosen) return;
  const b = $('#begin');
  b.disabled = true;
  try {
    const w = await api.getWheel(chosen);
    if (w.items.length < 2) throw new Error('that wheel needs at least two slots');
    game.setPlayers(players);
    game.setWheel(w);
    show('game');
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
  }
});

// ---- scenes and the High Scores ----
scene.init({ isBusy: () => game.busy() });
scene.setPlayers(players);

// ---- editor ----
initEditor({ changed: () => { if (screen === 'setup') loadWheels(); } });
for (const b of document.querySelectorAll('[data-editor]')) b.addEventListener('click', () => openEditor());

// ---- timer ----
initClock($('.clock'));
const timer = initTimer($('#timer'), { klaxon: audio.klaxon });
$('#timer-btn').addEventListener('click', (e) => {
  const open = $('#timer').hidden;
  if (!open) timer.terminate();
  $('#timer').hidden = !open;
  e.currentTarget.setAttribute('aria-pressed', String(open));
  e.currentTarget.classList.toggle('on', open);
});

// ---- keys ----
const anyDialogOpen = () => !!document.querySelector('dialog[open]');
const isField = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
document.addEventListener('keydown', (e) => {
  if (screen !== 'game' || e.code !== 'Space' || e.repeat || anyDialogOpen() || isField(e.target)) return;
  if (e.target.closest?.('button') && e.target !== $('#spin')) return; // Space presses a focused button
  e.preventDefault();
  game.spin();
});

// ---- keep the screen awake during play ----
let lock = null;
let wantWake = false;
async function wake(on) {
  wantWake = on;
  if (!('wakeLock' in navigator)) return;
  if (on && !lock && document.visibilityState === 'visible') {
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch {}
  } else if (!on && lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}
document.addEventListener('visibilitychange', () => { if (wantWake) wake(true); });

// ---- go ----
// The age gate, every visit: Enter starts the music and the titles; Leave goes to leave.html.
function ageGate() {
  const gate = $('#gate');
  return new Promise((resolve) => {
    $('#gate-no').addEventListener('click', () => location.replace('leave.html'));
    $('#gate-yes').addEventListener('click', () => {
      entered = true;
      audio.unlock();
      music.start();
      gate.classList.add('out');
      setTimeout(() => { gate.hidden = true; resolve(); }, 600);
    });
    $('#gate-yes').focus({ preventScroll: true });
  });
}

async function boot() {
  const intro = $('#intro');
  const hook = local && /^#(skip|autospin|setup|editor|timertest)/.test(location.hash);
  if (hook) { $('#gate').hidden = true; entered = true; } else await ageGate();
  intro.classList.add('in');
  if (hook) intro.classList.add('skipping');
  else {
    // the players screen is laid out (still invisible, under the titles) so the intro's
    // logo can be placed on its logo, then only the black behind the logo fades away
    $('#names').hidden = false;
    await playIntro(intro, () => (menuLogo.classList.contains('gone') ? $('.menu-title') : menuLogo));
    intro.classList.add('handoff');
  }
  show('names');
}
boot();

// Local test hooks (127.0.0.1 only):
//   #skip                 straight to the players screen
//   #setup / #editor[=n]  the decree / the workshop (editing wheel n)
//   #autospin[=kind]      skip ahead to the game with the first wheel and spin
if (local && /^#(setup|editor)/.test(location.hash)) {
  setTimeout(() => {
    $('#giver').value = 'Mistress';
    $('#receiver').value = 'Pet';
    $('#names-form').requestSubmit();
    const m = location.hash.match(/^#editor(?:=(\d+))?/);
    if (m) setTimeout(async () => openEditor(m[1] != null ? (await api.listWheels())[+m[1]].id : undefined), 700);
  }, 100);
}
if (local && location.hash === '#timertest') {
  // hold + for 7 s, then check the dial: 1,5,15,30,60-minute steps should be well past an hour
  const out = (k, v) => document.body.setAttribute(`data-${k}`, v);
  const plus = $('#timer [data-t="plus"]');
  const led = () => $('#timer .led').getAttribute('aria-label');
  setTimeout(() => {
    plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    out('t-after-tap', led());
    setTimeout(() => out('t-1s', led()), 1000);
    setTimeout(() => out('t-3s', led()), 3000);
    setTimeout(() => {
      plus.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      out('t-7s', led());
      const before = led();
      setTimeout(() => out('t-released', `${before === led()}`), 1000);
      $('#timer [data-t="play"]').click();
      setTimeout(() => { out('t-running', led()); $('#timer [data-t="stop"]').click(); out('t-stopped', led()); $('#timer [data-t="reset"]').click(); out('t-reset', led()); }, 3000);
    }, 7000);
  }, 300);
}
if (local && location.hash.startsWith('#autospin')) {
  // headless Chromium starves rAF; timers do advance under --virtual-time-budget
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  const drama = location.hash.split('=')[1];
  (async () => {
    const [first] = await api.listWheels();
    players = { giver: 'Mistress', receiver: 'Pet' };
    game.setPlayers(players);
    game.setWheel(await api.getWheel(first.id));
    $('#intro').hidden = true;
    show('game');
    setTimeout(() => game.spin({ strength: 0.2, drama }), 600);
    // canvas captures are often blank headless; count lit pixels instead
    setTimeout(() => {
      const c = $('#wheel');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
      document.body.dataset.px = `${c.width}x${c.height} lit=${(lit / (d.length / 4) * 100).toFixed(1)}%`;
    }, 14000);
  })();
}
