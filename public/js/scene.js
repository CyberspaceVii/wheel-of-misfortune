// Scenes and the High Scores.
//
// A scene starts with its first spin and counts every landing until someone taps one of the
// two faces in the corner of the game screen: the smile says Player 1 wins, the frown says
// Player 2 loses. (The same verdict told from either side; the pair picks the one that fits.)
// Tapping asks first; on OK the scene goes into the High Scores (names, spins, verdict, date),
// kept on this device like the Record, and the next spin starts a new scene.
//
// The open scene survives a reload. It belongs to one pair of players: a different pair
// starts a new scene on their first spin.

import { $, el, nm, confirmBox, toast } from './ui.js';

const SCENE_KEY = 'wom.scene';
const SCORES_KEY = 'wom.scores';
const KEEP = 300;

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let scene = load(SCENE_KEY, null);    // { giver, receiver, spins, started, wheels: [] }
let scores = load(SCORES_KEY, []);    // [{ at, giver, receiver, spins, outcome: 'win'|'lose', wheels }]
let players = { giver: '', receiver: '' };
let busy = () => false;

// ---- the faces: hand-drawn in one wobbly pen stroke each, ink in currentColor ----------------
const SVG = 'http://www.w3.org/2000/svg';
const HEAD = 'M24.6 6.1c9.5-.2 17.6 7.6 17.3 17.7-.3 9.6-8.1 17.9-18.2 17.7C13.9 41.3 6.3 33.4 6.5 23.6 6.7 14.2 13.6 6.9 22.8 6.2c2.1-.2 4 .4 5.6 1.3';
const FACES = {
  win: [HEAD, 'M17.6 17.6c.2 1.5.3 3 .1 4.4', 'M30.1 17.2c.3 1.6.3 3.1 0 4.6', 'M14.2 26.9c2.3 4.9 6.2 7.5 10.4 7.4 4.3-.1 7.8-2.8 9.9-7.9', 'M12.9 26.1l2.4 1.4'],
  lose: [HEAD, 'M17.4 18.1c.2 1.5.3 3 .1 4.4', 'M30.3 17.6c.3 1.6.3 3.1 0 4.6', 'M15.6 34.6c2.1-3.8 5.5-5.9 9.2-5.9 3.8 0 7 2.1 9.1 6.1', 'M33.2 35.4l1.9-1.6'],
};

export function face(kind) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('face', kind);
  for (const d of FACES[kind]) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

const spinsText = (n) => `${n} ${n === 1 ? 'spin' : 'spins'}`;
const ours = () => scene && scene.spins > 0 && scene.giver === players.giver && scene.receiver === players.receiver;

// ---- the game screen ------------------------------------------------------------------------

export function init({ isBusy }) {
  busy = isBusy;
  for (const kind of ['win', 'lose']) {
    const b = $(`#verdict-${kind}`);
    b.prepend(face(kind));
    b.addEventListener('click', () => declare(kind));
  }
  $('#scores-btn').addEventListener('click', openScores);
  $('#scores-clear').addEventListener('click', async () => {
    if (!(await confirmBox('Erase every high score? There is no undo.', { ok: 'Erase them', cancel: 'Keep them', danger: true }))) return;
    scores = [];
    save(SCORES_KEY, scores);
    openScores();
  });
  render();
}

export function setPlayers(p) {
  players = { giver: p.giver, receiver: p.receiver };
  render();
}

// After every landing (game.js).
export function spun(wheelName) {
  if (!scene || scene.giver !== players.giver || scene.receiver !== players.receiver) {
    scene = { giver: players.giver, receiver: players.receiver, spins: 0, started: Date.now(), wheels: [] };
  }
  scene.spins++;
  if (wheelName && !scene.wheels.includes(wheelName)) scene.wheels.push(wheelName);
  save(SCENE_KEY, scene);
  render();
}

function render() {
  const on = ours();
  for (const kind of ['win', 'lose']) {
    const b = $(`#verdict-${kind}`);
    b.disabled = !on;
    const who = kind === 'win' ? players.giver : players.receiver;
    b.title = on ? `${who} ${kind === 'win' ? 'wins' : 'loses'} · end the scene (${spinsText(scene.spins)})` : 'Spin first: a scene needs at least one spin';
    b.setAttribute('aria-label', b.title);
  }
}

async function declare(kind) {
  if (!ours()) return;
  if (busy()) return toast('Not while the Wheel is turning');
  const who = kind === 'win' ? scene.giver : scene.receiver;
  const msg = el('span', { class: 'verdict-q' },
    face(kind),
    el('span', {}, 'The scene is over: ', nm(who), kind === 'win' ? ' wins' : ' loses',
      `, after ${spinsText(scene.spins)}. Is that the right verdict?`));
  if (!(await confirmBox(msg, { ok: 'OK', cancel: 'Cancel' }))) return;
  scores.push({ at: Date.now(), giver: scene.giver, receiver: scene.receiver, spins: scene.spins, outcome: kind, wheels: scene.wheels });
  if (scores.length > KEEP) scores = ranked().slice(0, KEEP);
  save(SCORES_KEY, scores);
  scene = null;
  save(SCENE_KEY, null);
  render();
  toast('Into the High Scores. The next spin starts a new scene.');
}

// ---- the High Scores --------------------------------------------------------------------------

// most spins first; a tie goes to the more recent scene
const ranked = () => [...scores].sort((a, b) => b.spins - a.spins || b.at - a.at);

const fmtDate = (t) => new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

function openScores() {
  const ol = $('#scores-dlg ol');
  ol.replaceChildren();
  const list = ranked();
  if (!list.length) ol.append(el('li', { class: 'empty', text: 'No scenes finished yet. Spin, then pick a face when it’s over.' }));
  list.forEach((s, i) => {
    const verdict = s.outcome === 'win' ? 'wins' : 'loses';
    ol.append(el('li', { 'aria-label': `${i + 1}. ${s.giver} and ${s.receiver}, ${spinsText(s.spins)}, ${s.outcome === 'win' ? s.giver : s.receiver} ${verdict}`, title: s.wheels?.length ? s.wheels.join(', ') : null },
      el('span', { class: 'no', text: `#${i + 1}` }),
      el('span', { class: 'what' }, nm(s.giver), ' & ', nm(s.receiver)),
      el('span', { class: 'meta', text: `${spinsText(s.spins)} · ${fmtDate(s.at)}` }),
      el('span', { class: 'out', title: `${s.outcome === 'win' ? s.giver : s.receiver} ${verdict}` }, face(s.outcome))));
  });
  $('#scores-clear').hidden = !list.length;
  if (!$('#scores-dlg').open) $('#scores-dlg').showModal();
}
