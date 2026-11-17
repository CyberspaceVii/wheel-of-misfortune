// The wheel API (server/api.php): one shared set of wheels on the server, open to anyone
// (no login). A 429 means this connection made too many changes for now.

const BASE = 'api/';

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'X-WoM': '1', ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  if (!r.ok) throw new Error(body?.error || `the Wheel refused (${r.status})`);
  return body;
}

const post = (path, data) =>
  req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {}) });

export const listWheels = () => req('wheels').then((b) => b.wheels);
export const getWheel = (id) => req(`wheels/${id}`).then((b) => b.wheel);
export const saveWheel = (w) => post(w.id ? `wheels/${w.id}` : 'wheels', w).then((b) => b.wheel);
export const copyWheel = (id) => post(`wheels/${id}/copy`).then((b) => b.wheel);
export const deleteWheel = (id) => post(`wheels/${id}/delete`);

export function upload(file, kind) {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file);
  return req('upload', { method: 'POST', body: fd });
}

export const soundStatus = (url) => req(`status?u=${encodeURIComponent(url)}`);

// A slot's image/sound as something <img>/<audio> can load: a server path (media/…) or a
// built-in sting (synth:…); anything else is "".
export const media = (ref) => (/^(?:media\/|synth:)/.test(ref || '') ? ref : '');
