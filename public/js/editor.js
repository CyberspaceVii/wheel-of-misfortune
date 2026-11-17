// The Workshop: create, edit, copy and delete the shared wheels on the server.
//
// A wheel: name, description, slots. A slot: label, description (with
// @Player1/@Player2 placeholders), image, sound (a built-in sting or an
// upload) and weight 1 (exceptionally rare) … 10 (highly likely). Weights set
// the odds; every wedge is drawn the same size whatever its weight.
//
// Ideal slot count is about looks only: even, 8 to 24. Fewer than 8 or an odd
// count → offer to add blank slots or fill them at random.

import * as api from './api.js';
import * as audio from './audio.js';
import { $, el, choose, confirmBox, toast, modernTags, tagged, tagField } from './ui.js';
import { rand } from './rng.js';

const IDEAL_MIN = 8;
const IDEAL_MAX = 24;
const MAX_SLOTS = 48;

const SYNTHS = [['synth:gong', 'Gong'], ['synth:thunder', 'Thunder'], ['synth:bell', 'Bell']];

// themed filler for "fill at random"
const FILLERS = [
  { label: 'Spin Again', weight: 6, description: 'Nothing happens. Yet. Spin again.' },
  { label: 'Kiss', weight: 6, description: '@Player2 kisses @Player1 wherever @Player1 points. Take your time.' },
  { label: 'Five Spanks', weight: 7, sound: 'synth:thunder', description: 'Five, hard enough to remember, counted aloud by @Player2.' },
  { label: 'Kneel', weight: 6, description: 'On your knees until the next spin, @Player2. Eyes down.' },
  { label: 'Blindfold', weight: 5, sound: 'synth:bell', description: 'Blindfolded for the next two spins.' },
  { label: 'Silence', weight: 5, description: '@Player2 may not make a sound until the next spin. Every sound earns a spank.' },
  { label: 'Strip', weight: 5, description: 'One item of clothing, chosen by @Player1, removed slowly.' },
  { label: 'Confession', weight: 4, sound: 'synth:bell', description: '@Player2 confesses something @Player1 doesn\'t know yet.' },
  { label: 'Massage', weight: 5, description: 'Three minutes of @Player2\'s hands wherever @Player1 is tense. Do it well.' },
  { label: 'Bite', weight: 4, description: '@Player1 leaves a bite wherever they like. @Player2 says thank you.' },
  { label: 'Hair Pull', weight: 4, description: 'A fistful of hair and a very close whisper from @Player1.' },
  { label: 'Pose', weight: 4, description: '@Player2 holds a pose of @Player1\'s choosing for one minute. Set the timer.' },
  { label: 'Tickle', weight: 4, description: 'Thirty seconds, wrists held. Squirming is expected.' },
  { label: 'Ice Cube', weight: 4, description: 'An ice cube, traced slowly wherever @Player1 pleases.' },
  { label: 'Sovereign\'s Choice', weight: 3, description: '@Player1 names the next ordeal. The Wheel approves.' },
  { label: 'Double Down', weight: 3, sound: 'synth:thunder', description: 'Spin twice more. Both results stand.' },
  { label: 'Mercy', weight: 2, sound: 'synth:bell', description: 'A reprieve: skip the next result.' },
  { label: 'Wheel\'s Favour', weight: 1, sound: 'synth:gong', description: 'For one spin, @Player2 commands @Player1.' },
];

const weightWord = (w) =>
  w <= 1 ? 'exceptionally rare' : w <= 3 ? 'rare' : w <= 6 ? 'common' : w <= 8 ? 'likely' : 'highly likely';

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
const blank = () => ({ id: newId(), label: '', description: '', image: '', sound: '', weight: 5 });

const dlg = $('#editor-dlg');
const body = dlg.querySelector('.ed-body');

let onChange = () => {};
let draft = null;       // wheel being edited
let saved = '';         // JSON of the last saved draft, for "unsaved changes"
let open = new Set();   // expanded slot ids
let polling = new Map(); // sound url → timer

const dirty = () => draft && JSON.stringify(strip(draft)) !== saved;
const strip = (w) => ({ name: w.name, description: w.description, items: w.items.map(({ voice, ...it }) => it) });

export function initEditor({ changed }) {
  onChange = changed;
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); tryClose(); });
  dlg.querySelector('[data-ed-close]').addEventListener('click', tryClose);
  dlg.addEventListener('close', () => {
    audio.stopSound();
    for (const t of polling.values()) clearTimeout(t);
    polling.clear();
  });
}

export async function openEditor(editId) {
  draft = null;
  if (!dlg.open) dlg.showModal();
  if (editId) await edit(editId);
  else await showList();
}

async function tryClose() {
  if (dirty() && !(await confirmBox('Leave without saving? Your changes to this wheel will be lost.', { ok: 'Discard changes', cancel: 'Keep editing', danger: true }))) return;
  draft = null;
  dlg.close();
}

// ---------------------------------------------------------------- list view

async function showList() {
  draft = null;
  body.replaceChildren(el('p', { class: 'ed-wait', text: 'Consulting the archive…' }));
  let wheels;
  try {
    wheels = await api.listWheels();
  } catch (e) {
    body.replaceChildren(el('p', { class: 'ed-error', text: `The archive is sealed: ${e.message}` }));
    return;
  }
  body.replaceChildren(
    el('h2', { text: 'The Workshop' }),
    el('p', { class: 'ed-lede', text: 'Build the wheels. They’re kept on the server and shared: everyone who plays here sees them and can change them.' }),
    el('div', { class: 'ed-actions' }, el('button', { type: 'button', class: 'btn', text: '+ New wheel', onclick: () => edit(null) })),
    el('ul', { class: 'ed-list' },
      wheels.length ? wheels.map((w) =>
        el('li', {},
          el('div', { class: 'ed-meta' },
            el('strong', { text: w.name }),
            el('span', {}, `${w.count} slot${w.count === 1 ? '' : 's'}${w.description ? ' · ' : ''}`, tagged(modernTags(w.description)))),
          el('div', { class: 'ed-row-btns' },
            el('button', { type: 'button', class: 'btn small', text: 'Edit', onclick: () => edit(w.id) }),
            el('button', { type: 'button', class: 'btn small quiet', text: 'Copy', onclick: () => copy(w) }),
            el('button', { type: 'button', class: 'btn small danger', text: 'Delete', onclick: () => remove(w) }))))
        : el('li', { class: 'empty', text: 'No wheels yet. Make one.' })));
}

async function copy(w) {
  try {
    await api.copyWheel(w.id);
    toast(`Copied “${w.name}”`);
    onChange();
    showList();
  } catch (e) { toast(e.message); }
}

async function remove(w) {
  if (!(await confirmBox(`Delete “${w.name}” for good? This can't be undone.`, { ok: 'Delete it', cancel: 'Keep it', danger: true }))) return;
  try {
    await api.deleteWheel(w.id);
    toast(`“${w.name}” is gone`);
    onChange();
    showList();
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- edit view

async function edit(id) {
  if (id) {
    body.replaceChildren(el('p', { class: 'ed-wait', text: 'Fetching the wheel…' }));
    try {
      draft = await api.getWheel(id);
    } catch (e) {
      body.replaceChildren(el('p', { class: 'ed-error', text: e.message }));
      return;
    }
  } else {
    draft = { name: '', description: '', items: Array.from({ length: IDEAL_MIN }, blank) };
  }
  draft.description = modernTags(draft.description);
  for (const it of draft.items) it.description = modernTags(it.description);
  saved = id ? JSON.stringify(strip(draft)) : '';
  open = new Set(id ? [] : [draft.items[0]?.id]);
  renderEdit();
}

function renderEdit() {
  const nameIn = el('input', { type: 'text', maxlength: 60, value: draft.name, placeholder: 'The wheel needs a name', required: true, oninput: (e) => { draft.name = e.target.value; } });
  const descIn = el('textarea', { rows: 2, maxlength: 600, value: draft.description, placeholder: 'What is this wheel for?', oninput: (e) => { draft.description = e.target.value; } });
  body.replaceChildren(
    el('button', { type: 'button', class: 'ed-back', text: '← All wheels', onclick: async () => {
      if (dirty() && !(await confirmBox('Go back without saving?', { ok: 'Discard changes', cancel: 'Keep editing', danger: true }))) return;
      showList();
    } }),
    el('h2', { text: draft.id ? 'Edit wheel' : 'New wheel' }),
    el('label', { class: 'fld' }, el('span', { text: 'Name' }), nameIn),
    el('label', { class: 'fld' }, el('span', { text: 'Description' }), tagField(descIn)),
    el('div', { class: 'ed-slots-head' },
      el('h3', { text: 'Slots' }),
      el('span', { class: 'ed-count' }),
      el('button', { type: 'button', class: 'btn small', text: '+ Add slot', onclick: () => addSlots(1, false) })),
    el('p', { class: 'ed-hint' }, tagged('In descriptions, @Player1 and @Player2 become the players’ names. Weight sets the odds; wedges are all drawn the same size.')),
    el('div', { class: 'balance' }),
    el('ol', { class: 'slots' }),
    el('div', { class: 'ed-foot' },
      el('button', { type: 'button', class: 'btn quiet', text: 'Cancel', onclick: tryClose }),
      el('button', { type: 'button', class: 'btn primary', text: 'Save wheel', onclick: save })));
  renderSlots();
  if (!draft.id) nameIn.focus();
}

function renderSlots() {
  const list = body.querySelector('.slots');
  const total = draft.items.reduce((a, it) => a + (it.weight || 5), 0) || 1;
  list.replaceChildren(...draft.items.map((it, i) => slotCard(it, i, total)));
  renderBalance();
}

// odds text only, without rebuilding the cards (keeps focus while typing/sliding)
function refreshOdds() {
  const total = draft.items.reduce((a, it) => a + (it.weight || 5), 0) || 1;
  body.querySelectorAll('.slot').forEach((card, i) => {
    const it = draft.items[i];
    card.querySelector('.odds').textContent = `${weightWord(it.weight)} · ${((it.weight / total) * 100).toFixed(1)}%`;
    card.querySelector('.wval').textContent = it.weight;
  });
  renderBalance();
}

function balanceIssue(n) {
  if (n < IDEAL_MIN) return { add: IDEAL_MIN - n, msg: `Only ${n} slot${n === 1 ? '' : 's'}. A wheel looks right with at least ${IDEAL_MIN}.` };
  if (n % 2 && n < MAX_SLOTS) return { add: 1, msg: `${n} slots: an odd count leaves the wheel lopsided.` };
  if (n > IDEAL_MAX) return { add: 0, msg: `${n} slots: past ${IDEAL_MAX} the labels get hard to read.` };
  return null;
}

function renderBalance() {
  const n = draft.items.length;
  body.querySelector('.ed-count').textContent = `${n} / ideal ${IDEAL_MIN}–${IDEAL_MAX}, even`;
  const box = body.querySelector('.balance');
  const issue = balanceIssue(n);
  box.classList.toggle('ok', !issue);
  if (!issue) {
    box.replaceChildren(el('span', { text: `${n} slots. The wheel is balanced.` }));
    return;
  }
  box.replaceChildren(el('span', { text: issue.msg }),
    issue.add ? el('span', { class: 'bal-btns' },
      el('button', { type: 'button', class: 'btn small', text: `Add ${issue.add} blank`, onclick: () => addSlots(issue.add, false) }),
      el('button', { type: 'button', class: 'btn small', text: `Fill ${issue.add} at random`, onclick: () => addSlots(issue.add, true) })) : null);
}

function addSlots(k, random) {
  k = Math.min(k, MAX_SLOTS - draft.items.length);
  if (k <= 0) return toast(`${MAX_SLOTS} slots is the limit`);
  const have = new Set(draft.items.map((it) => it.label.trim().toLowerCase()));
  const pool = FILLERS.filter((f) => !have.has(f.label.toLowerCase()));
  for (let i = 0; i < k; i++) {
    if (random && pool.length) {
      const f = pool.splice(Math.floor(rand() * pool.length), 1)[0];
      draft.items.push({ ...blank(), ...f });
    } else {
      const b = blank();
      draft.items.push(b);
      if (!random) open.add(b.id);
    }
  }
  renderSlots();
  const lastCard = body.querySelector('.slots').lastElementChild;
  lastCard?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!random) lastCard?.querySelector('.lbl')?.focus({ preventScroll: true });
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= draft.items.length) return;
  [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]];
  renderSlots();
  body.querySelectorAll('.slot')[j]?.querySelector(d < 0 ? '.up' : '.down')?.focus();
}

async function removeSlot(i) {
  const it = draft.items[i];
  if ((it.label || it.description || it.image) && !(await confirmBox(`Remove “${it.label || 'this slot'}”?`, { ok: 'Remove', cancel: 'Keep', danger: true }))) return;
  draft.items.splice(i, 1);
  renderSlots();
}

function slotCard(it, i, total) {
  const isOpen = open.has(it.id);
  const card = el('li', { class: `slot${isOpen ? ' open' : ''}` });

  const label = el('input', {
    type: 'text', class: 'lbl', maxlength: 48, value: it.label, placeholder: `Slot ${i + 1}`, 'aria-label': `Slot ${i + 1} label`,
    oninput: (e) => { it.label = e.target.value; },
  });
  const weight = el('input', {
    type: 'range', min: 1, max: 10, step: 1, value: String(it.weight), 'aria-label': 'Weight',
    oninput: (e) => { it.weight = +e.target.value; refreshOdds(); },
  });
  const toggle = el('button', {
    type: 'button', class: 'iconish more', 'aria-expanded': String(isOpen), 'aria-label': 'Details', title: 'Details',
    text: '▾',
    onclick: () => {
      const now = !card.classList.contains('open');
      card.classList.toggle('open', now);
      toggle.setAttribute('aria-expanded', String(now));
      now ? open.add(it.id) : open.delete(it.id);
    },
  });

  // ---- details ----
  const desc = el('textarea', {
    rows: 3, maxlength: 2000, value: it.description, placeholder: 'What happens. @Player1 and @Player2 become the players’ names.',
    oninput: (e) => { it.description = e.target.value; },
  });

  const thumb = el('img', { class: 'thumb', alt: '', hidden: !it.image });
  if (it.image) thumb.src = it.image;
  const imgStatus = el('span', { class: 'st' });
  const imgFile = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
  const imgRemove = el('button', { type: 'button', class: 'btn small quiet', text: 'Remove', hidden: !it.image, onclick: () => {
    it.image = '';
    thumb.hidden = true;
    thumb.removeAttribute('src');
    imgRemove.hidden = true;
  } });
  imgFile.addEventListener('change', async () => {
    const f = imgFile.files[0];
    imgFile.value = '';
    if (!f) return;
    imgStatus.textContent = 'uploading…';
    try {
      const { url } = await api.upload(f, 'image');
      it.image = url;
      thumb.src = url;
      thumb.hidden = false;
      imgRemove.hidden = false;
      imgStatus.textContent = '';
    } catch (e) {
      imgStatus.textContent = e.message;
    }
  });

  const soundSel = el('select', { 'aria-label': 'Sound' },
    el('option', { value: '', text: 'No sound' }),
    SYNTHS.map(([v, t]) => el('option', { value: v, text: t })),
    el('option', { value: 'upload', text: 'Uploaded sound' }));
  const soundStatus = el('span', { class: 'st' });
  const soundFile = el('input', { type: 'file', accept: '.mp3,.flac,.ogg,.oga,.wav,audio/mpeg,audio/flac,audio/ogg,audio/wav', hidden: true });
  const setSel = () => {
    soundSel.value = it.sound.startsWith('media/') ? 'upload' : it.sound;
    soundSel.querySelector('[value="upload"]').disabled = !it.sound.startsWith('media/');
  };
  setSel();
  soundSel.addEventListener('change', () => {
    if (soundSel.value === 'upload') return;
    it.sound = soundSel.value;
    soundStatus.textContent = '';
    setSel();
  });
  soundFile.addEventListener('change', async () => {
    const f = soundFile.files[0];
    soundFile.value = '';
    if (!f) return;
    soundStatus.textContent = 'uploading…';
    try {
      const { url } = await api.upload(f, 'sound');
      it.sound = url;
      setSel();
      watchSound(url, soundStatus);
    } catch (e) {
      soundStatus.textContent = e.message;
    }
  });
  if (it.sound.startsWith('media/')) watchSound(it.sound, soundStatus, true);
  const preview = el('button', { type: 'button', class: 'btn small quiet', text: '▶ Play', onclick: () => {
    if (!it.sound) return;
    audio.unlock();
    audio.stopSound();
    audio.playSound(it.sound);
  } });

  card.append(
    el('div', { class: 'slot-top' },
      el('span', { class: 'idx', text: i + 1 }),
      label,
      el('div', { class: 'w' }, weight, el('span', { class: 'wval', text: it.weight }), el('span', { class: 'odds', text: `${weightWord(it.weight)} · ${((it.weight / total) * 100).toFixed(1)}%` })),
      el('div', { class: 'slot-btns' },
        el('button', { type: 'button', class: 'iconish up', 'aria-label': 'Move up', title: 'Move up', text: '↑', disabled: i === 0, onclick: () => move(i, -1) }),
        el('button', { type: 'button', class: 'iconish down', 'aria-label': 'Move down', title: 'Move down', text: '↓', disabled: i === draft.items.length - 1, onclick: () => move(i, 1) }),
        el('button', { type: 'button', class: 'iconish del', 'aria-label': 'Remove slot', title: 'Remove slot', text: '×', onclick: () => removeSlot(i) }),
        toggle)),
    el('div', { class: 'slot-more' },
      el('label', { class: 'fld' }, el('span', { text: 'Description' }), tagField(desc)),
      el('div', { class: 'media-row' },
        el('div', { class: 'media' },
          el('span', { class: 'mlabel', text: 'Image' }),
          thumb,
          el('button', { type: 'button', class: 'btn small', text: it.image ? 'Replace' : 'Upload', onclick: () => imgFile.click() }),
          imgRemove, imgStatus, imgFile),
        el('div', { class: 'media' },
          el('span', { class: 'mlabel', text: 'Sound' }),
          soundSel,
          el('button', { type: 'button', class: 'btn small', text: 'Upload', onclick: () => soundFile.click() }),
          preview, soundStatus, soundFile))));
  return card;
}

// Uploaded sounds are transcoded by the server's worker; poll until done.
function watchSound(url, statusEl, quiet) {
  clearTimeout(polling.get(url));
  let tries = 0;
  const check = async () => {
    try {
      const st = await api.soundStatus(url);
      if (st.ready) { statusEl.textContent = quiet ? '' : 'ready'; polling.delete(url); return; }
      if (st.failed) { statusEl.textContent = 'that file could not be used'; polling.delete(url); return; }
    } catch {}
    statusEl.textContent = 'processing…';
    if (++tries < 60) polling.set(url, setTimeout(check, 1500));
    else statusEl.textContent = 'still processing; check back later';
  };
  check();
}

async function save() {
  draft.name = draft.name.trim();
  if (!draft.name) {
    toast('The wheel needs a name');
    body.querySelector('.fld input')?.focus();
    return;
  }
  const unnamed = draft.items.filter((it) => !it.label.trim()).length;
  if (unnamed) {
    const k = await choose(`${unnamed} slot${unnamed === 1 ? ' has' : 's have'} no label and will be dropped when saved.`, [
      { key: 'save', label: 'Drop them and save' },
      { key: 'back', label: 'Keep editing', quiet: true },
    ]);
    if (k !== 'save') return;
  }
  const n = draft.items.filter((it) => it.label.trim()).length;
  if (n < 2) return toast('A wheel needs at least two labelled slots');
  const issue = balanceIssue(n);
  if (issue && issue.add) {
    const k = await choose(`${issue.msg} Add ${issue.add} more?`, [
      { key: 'blank', label: `Add ${issue.add} blank` },
      { key: 'random', label: `Fill ${issue.add} at random` },
      { key: 'save', label: 'Save as it is', quiet: true },
    ]);
    if (k === null) return;
    if (k !== 'save') {
      if (unnamed) draft.items = draft.items.filter((it) => it.label.trim());
      addSlots(issue.add, k === 'random');
      if (k === 'blank') return toast('Name the new slots, then save');
    }
  }
  try {
    const w = await api.saveWheel({ ...strip(draft), id: draft.id });
    draft = w;
    saved = JSON.stringify(strip(draft));
    toast(`Saved “${w.name}”`);
    onChange();
    renderEdit();
  } catch (e) {
    toast(`Not saved: ${e.message}`);
  }
}
