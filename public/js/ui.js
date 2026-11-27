// Small shared UI helpers: a themed confirm box, element building, and the
// @Player1/@Player2 tags in slot text ({sovereign}/{subject}/{giver}/{receiver} are read as aliases).

export const $ = (s, root = document) => root.querySelector(s);

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  e.append(...kids.flat().filter((k) => k != null && k !== false)); // first, so a select's value can pick an option
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  return e;
}

// A player's name as an element, so names can wear their own hand (.nm, Homemade Apple).
export const nm = (name) => el('span', { class: 'nm', text: name });

// Fill @Player1/@Player2 into node as .nm spans, with URLs in the rest linked (linkText).
// {sovereign}/{subject} and {giver}/{receiver} are older spellings and still fill in.
const SEAT = { '@player1': 'giver', '@player2': 'receiver', '{sovereign}': 'giver', '{subject}': 'receiver', '{giver}': 'giver', '{receiver}': 'receiver' };
export function fillInto(node, text, players) {
  node.replaceChildren();
  for (const [i, part] of String(text || '').split(/(@player[12]\b|\{(?:sovereign|subject|giver|receiver)\})/i).entries()) {
    if (i % 2) node.append(nm(players[SEAT[part.toLowerCase()]]));
    else if (part) appendLinked(node, part);
  }
  return node;
}

// Script text with the older spellings brought up to @Player1/@Player2.
export const modernTags = (text) => String(text || '').replace(/\{(?:sovereign|giver)\}/gi, '@Player1').replace(/\{(?:subject|receiver)\}/gi, '@Player2');

// Script text as nodes with each valid tag highlighted (.ptag). A misspelt tag stays plain, so it shows.
export const tagged = (text) => String(text || '').split(/(@player[12]\b)/i).map((part, i) => (i % 2 ? el('mark', { class: 'ptag', text: part }) : part));

// A textarea whose valid tags show highlighted while typing: its own text is transparent over
// a mirror (.tag-back) that paints the same text with the tags marked. Returns the wrapper to place.
export function tagField(ta) {
  const back = el('div', { class: 'tag-back', 'aria-hidden': 'true' });
  const sync = () => {
    back.scrollTop = ta.scrollTop;
    back.style.right = `${Math.max(0, ta.offsetWidth - ta.clientWidth - 2)}px`; // a scrollbar narrows the text
  };
  const paint = () => { back.replaceChildren(...tagged(ta.value), '​'); sync(); }; // ​: a last empty line still counts
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', sync);
  new ResizeObserver(sync).observe(ta);
  paint();
  return el('div', { class: 'tag-field' }, back, ta);
}

// Ask with a row of choices; resolves to the chosen key, or null on Esc/backdrop.
// choices: [{ key, label, danger?, quiet? }]  (the last one gets focus)
export function choose(message, choices) {
  const d = $('#confirm-dlg');
  // a message may be a node: the scene verdict carries a face and the player's name in script
  const p = d.querySelector('p');
  if (message instanceof Node) p.replaceChildren(message);
  else p.textContent = message;
  const row = d.querySelector('.choices');
  let answer = null;
  const btns = choices.map((c) =>
    el('button', {
      type: 'button',
      class: c.danger ? 'btn danger' : c.quiet ? 'btn quiet' : 'btn',
      text: c.label,
      onclick: () => { answer = c.key; d.close(); },
    }));
  row.replaceChildren(...btns);
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(answer), { once: true });
    d.showModal();
    btns[btns.length - 1]?.focus();
  });
}

// Promise<boolean>
export async function confirmBox(message, { ok = 'Yes', cancel = 'No', danger = false } = {}) {
  return (await choose(message, [{ key: 'yes', label: ok, danger }, { key: 'no', label: cancel, quiet: true }])) === 'yes';
}

export function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.to);
  toast.to = setTimeout(() => t.classList.remove('show'), ms);
}

// Put text into a node with every http(s) URL turned into a link that opens in a new tab.
// Built from text nodes + <a> elements, never innerHTML, so a description can't inject markup.
export function linkText(node, text) {
  node.replaceChildren();
  appendLinked(node, text);
}

function appendLinked(node, text) {
  const re = /https?:\/\/[^\s<>"]+/g;
  const count = (s, c) => s.split(c).length - 1;
  let at = 0;
  for (const m of text.matchAll(re)) {
    // trailing punctuation belongs to the sentence; a ")" only if it doesn't close a "(" in the URL
    let url = m[0];
    while (/[.,;:!?\]]$/.test(url) || (url.endsWith(')') && count(url, '(') < count(url, ')'))) url = url.slice(0, -1);
    if (m.index > at) node.append(text.slice(at, m.index));
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url.replace(/^https?:\/\/(www\.)?/, '').replace(/_/g, ' ');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    node.append(a);
    at = m.index + url.length;
  }
  if (at < text.length) node.append(text.slice(at));
}

// Ask for one line of text (in the confirm box); resolves to what was typed, or null.
export function ask(message, { value = '', ok = 'OK', cancel = 'Cancel', type = 'text' } = {}) {
  const d = $('#confirm-dlg');
  d.querySelector('p').textContent = message;
  const input = el('input', { type, class: 'ask-in', value, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' });
  const form = el('form', { class: 'ask', method: 'dialog' }, input);
  d.querySelector('p').after(form);
  let answer = null;
  const done = (v) => { answer = v; d.close(); };
  form.addEventListener('submit', (e) => { e.preventDefault(); done(input.value); });
  d.querySelector('.choices').replaceChildren(
    el('button', { type: 'button', class: 'btn quiet', text: cancel, onclick: () => done(null) }),
    el('button', { type: 'button', class: 'btn', text: ok, onclick: () => done(input.value) }));
  return new Promise((resolve) => {
    d.addEventListener('close', () => { form.remove(); resolve(answer); }, { once: true });
    d.showModal();
    input.select();
  });
}
