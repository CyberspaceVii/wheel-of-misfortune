// Cryptographic randomness. Math.random() is never used for outcomes.

const buf = new Uint32Array(1);

// Uniform float in [0, 1).
export function rand() {
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export function randRange(lo, hi) {
  return lo + (hi - lo) * rand();
}

// Clamp a slot weight to the 1 (exceptionally rare) .. 10 (highly likely) scale.
export function clampWeight(w) {
  const n = Math.round(Number(w));
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 5;
}

// Weighted pick: returns an index into items. Wedge geometry plays no part;
// odds come only from the weights.
export function weightedIndex(items, r = rand()) {
  let total = 0;
  for (const it of items) total += clampWeight(it.weight);
  let x = r * total;
  for (let i = 0; i < items.length; i++) {
    x -= clampWeight(items[i].weight);
    if (x < 0) return i;
  }
  return items.length - 1;
}

// Pick a key from { key: probability } (probabilities need not sum to 1).
export function pickKey(table, r = rand()) {
  const keys = Object.keys(table);
  let total = 0;
  for (const k of keys) total += table[k];
  let x = r * total;
  for (const k of keys) {
    x -= table[k];
    if (x < 0) return k;
  }
  return keys[keys.length - 1];
}
