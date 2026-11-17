// Canvas renderer. The face (wedges, labels, pins) is pre-rendered to an
// offscreen canvas and only rotated per frame; the bezel/hub are cached too.
// Per frame: one rotated drawImage, the win glow, the flapper.
// Stained planks under black enamel steel: straps, rim band, bolts, hub. No bulbs.

import { TAU, POINTER } from './spin.js';

const RIM_BOLTS = 32;

const C = {
  // per wedge: oxblood-stained, ebonised, and (odd n) weathered grey
  wood: [
    { base: '#3b1013', dark: '#160406', light: '#62231f' },
    { base: '#1d1613', dark: '#070504', light: '#3a2c24' },
    { base: '#2a2527', dark: '#0d0b0c', light: '#4a4245' },
  ],
  ink: ['#e8dccb', '#b9a47c', '#ddd3c4'], // bone, tarnished brass, ash
  enamel: '#0b0b0d',
  glint: 'rgba(190,196,206,0.22)',
};

// small seeded PRNG so each plank's grain is the same on every redraw
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A domed steel rivet head.
function rivet(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = r * 0.8;
  ctx.shadowOffsetY = r * 0.25;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  g.addColorStop(0, '#a3a8b0');
  g.addColorStop(0.35, '#3c3f45');
  g.addColorStop(1, '#08080a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Fit a label into a wedge: one line if it fits, else two, shrinking as needed.
function fitLabel(ctx, text, maxLen, maxH, maxSize) {
  const font = (px) => `700 ${px}px ${LABEL_FONT}`;
  let size = Math.min(maxH * 0.78, maxSize);
  for (; size >= 7; size -= 0.5) {
    ctx.font = font(size);
    if (ctx.measureText(text).width <= maxLen) return { size, lines: [text], font: font(size) };
  }
  const words = text.split(/\s+/);
  if (words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      ctx.font = font(10);
      const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || w < best.w) best = { a, b, w };
    }
    for (size = Math.min(maxH * 0.42, maxSize); size >= 6; size -= 0.5) {
      ctx.font = font(size);
      if (Math.max(ctx.measureText(best.a).width, ctx.measureText(best.b).width) <= maxLen)
        return { size, lines: [best.a, best.b], font: font(size) };
    }
  }
  // Still too long: ellipsize at the minimum size.
  size = 7;
  ctx.font = font(size);
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxLen) t = t.slice(0, -1);
  return { size, lines: [t + '…'], font: font(size) };
}

// Wedge labels: the heading brush caps (Echoes Dominion), set as typed.
const LABEL_FONT = '"Echoes Dominion", Impact, sans-serif';

export class WheelView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.size = 0;
    this.dpr = 1;
    // canvas text doesn't wait for webfonts: redraw the labels once the face arrives
    document.fonts?.load(`700 40px ${LABEL_FONT}`).then(() => this.renderFace(), () => {});
  }

  setItems(items) {
    this.items = items;
    this.renderFace();
  }

  // Call on resize. css = CSS pixel width of the (square) canvas.
  resize(css) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(css * dpr);
    if (px === this.size && dpr === this.dpr) return;
    this.dpr = dpr;
    this.size = px;
    this.canvas.width = this.canvas.height = px;
    this.geom();
    this.renderFrame();
    this.renderFace();
  }

  geom() {
    const S = this.size;
    this.cx = this.cy = S / 2;
    this.rOuter = S * 0.49;
    this.rFace = S * 0.415;
    this.rBolt = (this.rOuter + this.rFace) / 2 + S * 0.003;
    this.rHub = this.rFace * 0.2;
  }

  wedgePath(ctx, r, a0, a1) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0, a1);
    ctx.closePath();
  }

  renderFace() {
    if (!this.size || !this.items.length) return;
    const n = this.items.length;
    const s = TAU / n;
    const R = this.rFace;
    const d = Math.ceil(R * 2 + 4);
    const face = (this.face = offscreen(d, d));
    const ctx = face.getContext('2d');
    ctx.translate(d / 2, d / 2);

    for (let i = 0; i < n; i++) {
      const ci = n % 2 && i === n - 1 ? 2 : i % 2;
      ctx.save();
      ctx.rotate(i * s + s / 2);
      this.plank(ctx, R, s, C.wood[ci], mulberry(i * 7919 + n));
      ctx.restore();
    }

    // depth: the planks sink into shadow at the hub and under the rim band
    const g = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.4, 'rgba(0,0,0,0.15)');
    g.addColorStop(0.85, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();

    // labels, along the radius, reading from the hub outward, all at one size: the
    // smallest any label needs, so short ones don't shout over long ones (ellipsized
    // labels don't vote; they'd drag the whole wheel down to 7px)
    const r0 = this.rHub * 1.25;
    const r1 = R * 0.9;
    const labels = this.items.map((it) => String(it.label || ''));
    const fits = labels.map((t) => fitLabel(ctx, t, r1 - r0, s * R * 0.58, R * 0.085));
    const voting = fits.filter((f) => f.size > 7 || !f.lines[0].endsWith('…'));
    const one = voting.length ? Math.min(...voting.map((f) => f.size)) : R * 0.085;
    for (let i = 0; i < n; i++) {
      const ci = n % 2 && i === n - 1 ? 2 : i % 2;
      const fit = fitLabel(ctx, labels[i], r1 - r0, s * R * 0.58, one);
      ctx.save();
      ctx.rotate(i * s + s / 2);
      ctx.fillStyle = C.ink[ci];
      ctx.font = fit.font;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = fit.size * 0.35;
      const lh = fit.size * 1.05;
      // dark keyline under the fill keeps thin strokes legible on the grain
      ctx.lineJoin = 'round';
      ctx.lineWidth = fit.size * 0.16;
      ctx.strokeStyle = '#0a0505';
      fit.lines.forEach((ln, k) => ctx.strokeText(ln, r1, (k - (fit.lines.length - 1) / 2) * lh));
      ctx.shadowColor = 'transparent';
      fit.lines.forEach((ln, k) => ctx.fillText(ln, r1, (k - (fit.lines.length - 1) / 2) * lh));
      ctx.restore();
    }

    // black enamel steel: a strap over every seam and a band round the rim
    const sw = Math.max(2, R * 0.022);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.rotate(i * s);
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = sw * 0.8;
      ctx.fillStyle = C.enamel;
      ctx.fillRect(this.rHub * 0.9, -sw / 2, R * 0.98 - this.rHub * 0.9, sw);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = C.glint;
      ctx.fillRect(this.rHub * 0.9, -sw / 2, R * 0.98 - this.rHub * 0.9, Math.max(1, sw * 0.14));
      ctx.restore();
    }
    const band = ctx.createRadialGradient(0, 0, R * 0.965, 0, 0, R);
    band.addColorStop(0, '#000');
    band.addColorStop(0.35, '#1d1e21');
    band.addColorStop(0.6, '#0a0a0c');
    band.addColorStop(1, '#000');
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.arc(0, 0, R * 0.965, 0, TAU, true);
    ctx.fill('evenodd');

    // rivets: a big one at the rim end of each strap (the flapper's pins), a small one midway
    for (let i = 0; i < n; i++) {
      const a = i * s;
      rivet(ctx, Math.cos(a) * R * 0.94, Math.sin(a) * R * 0.94, R * 0.024);
      rivet(ctx, Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, R * 0.012);
    }
  }

  // One wedge-shaped plank in its own frame (centre line on +x): stain, grain, knots, worn edges.
  plank(ctx, R, s, wood, rnd) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -s / 2, s / 2);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    const half = R * Math.sin(Math.min(s / 2, Math.PI / 2)) + 2;
    ctx.fillStyle = wood.base;
    ctx.fillRect(0, -half, R + 2, half * 2);
    // the grain runs the length of the plank
    const gap = Math.max(1.5, R * 0.011);
    const steps = 48;
    for (let y0 = -half; y0 < half; y0 += gap * (0.6 + rnd() * 0.8)) {
      const a1 = R * (0.002 + rnd() * 0.006), f1 = 2 + rnd() * 5, p1 = rnd() * TAU;
      const a2 = R * rnd() * 0.003, f2 = 9 + rnd() * 14, p2 = rnd() * TAU;
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) {
        const x = (k / steps) * R;
        const y = y0 + a1 * Math.sin((x / R) * f1 + p1) + a2 * Math.sin((x / R) * f2 + p2);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      const dark = rnd() < 0.62;
      ctx.strokeStyle = dark ? wood.dark : wood.light;
      ctx.globalAlpha = 0.18 + rnd() * (dark ? 0.5 : 0.3);
      ctx.lineWidth = Math.max(0.6, R * (0.0015 + rnd() * 0.004));
      ctx.stroke();
    }
    // a knot or two
    for (let k = rnd() < 0.7 ? 1 + (rnd() < 0.3) : 0; k > 0; k--) {
      const kx = R * (0.4 + rnd() * 0.45);
      const ky = (rnd() - 0.5) * kx * Math.sin(s / 2) * 0.9;
      const kr = R * (0.012 + rnd() * 0.014);
      ctx.strokeStyle = wood.dark;
      for (let ring = 4; ring > 0; ring--) {
        ctx.globalAlpha = 0.5 - ring * 0.08;
        ctx.lineWidth = Math.max(0.8, R * 0.003);
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * ring * 0.8, kr * ring * 0.38, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = wood.dark;
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr * 0.7, kr * 0.35, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // worn, darkened edges either side of the seam
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -s / 2, s / 2);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = R * 0.035;
    ctx.stroke();
    ctx.restore();
  }

  // Bezel, hub and sheen: static, cached once per size.
  renderFrame() {
    const S = this.size;
    const fr = (this.frame = offscreen(S, S));
    const ctx = fr.getContext('2d');
    const { cx, cy, rOuter: Ro, rFace: Rf } = this;

    // the rim: a ring of black enamel steel with a hard gloss
    const ring = () => {
      ctx.beginPath();
      ctx.arc(cx, cy, Ro, 0, TAU);
      ctx.arc(cx, cy, Rf, 0, TAU, true);
    };
    const bez = ctx.createRadialGradient(cx, cy, Rf, cx, cy, Ro);
    bez.addColorStop(0, '#030304');
    bez.addColorStop(0.22, '#16171a');
    bez.addColorStop(0.55, '#070708');
    bez.addColorStop(0.86, '#1b1c20');
    bez.addColorStop(1, '#020203');
    ctx.fillStyle = bez;
    ring();
    ctx.fill('evenodd');
    const gloss = ctx.createLinearGradient(cx - Ro, cy - Ro, cx + Ro, cy + Ro);
    gloss.addColorStop(0, 'rgba(210,215,225,0.2)');
    gloss.addColorStop(0.3, 'rgba(210,215,225,0.03)');
    gloss.addColorStop(0.7, 'rgba(210,215,225,0)');
    gloss.addColorStop(1, 'rgba(210,215,225,0.07)');
    ctx.fillStyle = gloss;
    ring();
    ctx.fill('evenodd');
    ctx.strokeStyle = '#3a3c41';
    ctx.lineWidth = S * 0.003;
    ctx.beginPath();
    ctx.arc(cx, cy, Ro - ctx.lineWidth / 2, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = S * 0.006;
    ctx.beginPath();
    ctx.arc(cx, cy, Rf + ctx.lineWidth / 2, 0, TAU);
    ctx.stroke();
    // bolts round the rim, leaving 12 o'clock to the flapper
    for (let i = 0; i < RIM_BOLTS; i++) {
      const a = POINTER + ((i + 0.5) / RIM_BOLTS) * TAU;
      rivet(ctx, cx + Math.cos(a) * this.rBolt, cy + Math.sin(a) * this.rBolt, S * 0.011);
    }

    // a cold sheen + vignette over the face (fixed to the light, not the wheel)
    const sh = ctx.createRadialGradient(cx - Rf * 0.45, cy - Rf * 0.55, 0, cx - Rf * 0.2, cy - Rf * 0.3, Rf * 1.1);
    sh.addColorStop(0, 'rgba(215,220,230,0.08)');
    sh.addColorStop(0.5, 'rgba(215,220,230,0.02)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(cx, cy, Rf, 0, TAU);
    ctx.fill();
    const vg = ctx.createRadialGradient(cx, cy, Rf * 0.75, cx, cy, Rf);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.arc(cx, cy, Rf, 0, TAU);
    ctx.fill();

    // hub: a steel boss, black enamel plate, a ring of bolts, a dark garnet cap
    const H = this.rHub;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = H * 0.3;
    const boss = ctx.createLinearGradient(cx - H, cy - H, cx + H, cy + H);
    boss.addColorStop(0, '#55585e');
    boss.addColorStop(0.4, '#1c1d20');
    boss.addColorStop(1, '#050506');
    ctx.fillStyle = boss;
    ctx.beginPath();
    ctx.arc(cx, cy, H, 0, TAU);
    ctx.fill();
    ctx.restore();
    const plate = ctx.createRadialGradient(cx - H * 0.3, cy - H * 0.35, 0, cx, cy, H * 0.84);
    plate.addColorStop(0, '#1e1f23');
    plate.addColorStop(0.6, '#08080a');
    plate.addColorStop(1, '#020203');
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.arc(cx, cy, H * 0.84, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      rivet(ctx, cx + Math.cos(a) * H * 0.64, cy + Math.sin(a) * H * 0.64, H * 0.07);
    }
    const cap = ctx.createRadialGradient(cx - H * 0.12, cy - H * 0.14, H * 0.02, cx, cy, H * 0.36);
    cap.addColorStop(0, '#b4444d');
    cap.addColorStop(0.3, '#6a0a15');
    cap.addColorStop(0.85, '#2a0207');
    cap.addColorStop(1, '#0c0003');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(cx, cy, H * 0.36, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = H * 0.05;
    ctx.stroke();
  }

  // state: { rotation, flap (radians, signed), win: index|null, winGlow: 0..1 }
  draw(st) {
    const ctx = this.ctx;
    const { cx, cy, size: S } = this;
    if (!S || !this.face) return;
    ctx.clearRect(0, 0, S, S);

    // face
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(st.rotation);
    ctx.drawImage(this.face, -this.face.width / 2, -this.face.height / 2);
    if (st.win != null && st.winGlow > 0) {
      // the chosen plank turns pale, like something seen by moonlight
      const s = TAU / this.items.length;
      const g = ctx.createRadialGradient(0, 0, this.rHub, 0, 0, this.rFace);
      g.addColorStop(0, 'rgba(205,210,220,0)');
      g.addColorStop(1, `rgba(205,210,220,${0.32 * st.winGlow})`);
      ctx.fillStyle = g;
      this.wedgePath(ctx, this.rFace * 0.96, st.win * s, (st.win + 1) * s);
      ctx.fill();
    }
    ctx.restore();

    ctx.drawImage(this.frame, 0, 0);
    this.drawFlapper(st.flap || 0);
  }

  // A black steel claw hanging from 12 o'clock, pivoting on a bolt where it meets the rim.
  drawFlapper(flap) {
    const ctx = this.ctx;
    const S = this.size;
    const px = this.cx;
    const py = this.cy - this.rOuter + S * 0.035;
    const len = this.rOuter - this.rFace + S * 0.03;
    const w = S * 0.034;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(flap);
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = S * 0.012;
    ctx.shadowOffsetY = S * 0.006;
    const g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, '#050506');
    g.addColorStop(0.35, '#4a4d53');
    g.addColorStop(0.55, '#16171a');
    g.addColorStop(1, '#020203');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(-w * 0.9, len * 0.55, 0, len);
    ctx.quadraticCurveTo(w * 0.9, len * 0.55, w, 0);
    ctx.arc(0, 0, w, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = S * 0.002;
    ctx.stroke();
    rivet(ctx, 0, 0, w * 0.42);
    ctx.restore();
  }

  // Is a CSS-pixel point (relative to the canvas) on the wheel face?
  hit(x, y) {
    const k = this.dpr;
    const dx = x * k - this.cx;
    const dy = y * k - this.cy;
    return Math.hypot(dx, dy) <= this.rOuter;
  }

  angleAt(x, y) {
    const k = this.dpr;
    return Math.atan2(y * k - this.cy, x * k - this.cx);
  }
}
