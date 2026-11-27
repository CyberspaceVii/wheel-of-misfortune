// Opening titles: the studio mark (the signature and heart, already complete) fades
// up from black, fades out, then the Wheel of Misfortune logo comes up exactly where the
// players screen has its own logo, and stays put while the menu fades in around it (no fade
// to black between them). After the first 1.5 s a tap, click or key skips straight to the
// logo on the menu. Resolves when the logo has held (or on the skip) and the hand-off can start.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// seconds; the studio fade-in is 1.6 s (wom.css), so it holds complete for ~2.8 s
const T = reduced
  ? { studioIn: 0, studioOut: 2.4, logoIn: 3.1, done: 5.4 }
  : { studioIn: 0.4, studioOut: 4.8, logoIn: 6.0, done: 9.9 };
const SKIP_AFTER = 1.5; // seconds of titles everyone sees before a tap can skip them

// target() returns the players-screen element to land on (its logo, or its typed title when
// there's no logo file); it must be laid out (not display: none) when this is called.
export function playIntro(root, target) {
  const studio = root.querySelector('.studio');
  const logo = root.querySelector('.brand');
  const img = logo.querySelector('img');
  // no logo file yet (or it fails): show the title in type instead
  const noLogo = () => logo.classList.add('no-logo');
  img.addEventListener('error', noLogo, { once: true });
  if (img.complete && !img.naturalWidth) noLogo();

  // sit the intro's logo on the menu's: same box, same type size
  const place = () => {
    const t = target();
    const r = t.getBoundingClientRect();
    if (!r.width) return;
    Object.assign(logo.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
    logo.querySelector('.brand-type').style.fontSize = getComputedStyle(t).fontSize;
    img.style.width = `${r.width}px`;
  };
  addEventListener('resize', place);

  return new Promise((resolve) => {
    const timers = [];
    const at = (s, fn) => timers.push(setTimeout(fn, s * 1000));
    const started = performance.now();
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      timers.forEach(clearTimeout);
      removeEventListener('resize', place);
      removeEventListener('pointerdown', skip, true);
      removeEventListener('keydown', skip, true);
      resolve();
    };
    // jump to the end: the studio mark goes, the logo comes up on the menu's as the menu fades in
    const skip = (e) => {
      if (performance.now() - started < SKIP_AFTER * 1000 || e.repeat) return;
      studio.classList.remove('on');
      place();
      logo.classList.add('on');
      finish();
    };
    addEventListener('pointerdown', skip, true);
    addEventListener('keydown', skip, true);
    at(T.studioIn, () => studio.classList.add('on'));
    at(T.studioOut, () => studio.classList.remove('on'));
    at(T.logoIn - 0.2, place);
    at(T.logoIn, () => logo.classList.add('on'));
    at(T.done, finish);
  });
}
