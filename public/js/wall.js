// Pick one wallpaper at random for this page load. Classic script in
// index.html; the images are built by tools/wall.sh (keep WALLS in step).
// Sets --wall on <html> through the CSSOM (CSP allows that; a style="" attribute it would not).
(() => {
  const WALLS = ['wall-1.webp', 'wall-2.webp', 'wall-3.webp', 'wall-4.webp', 'wall-5.webp', 'wall-6.webp', 'wall-7.webp', 'wall-8.webp', 'wall-9.webp'];
  const pick = WALLS[(crypto.getRandomValues(new Uint32Array(1))[0]) % WALLS.length];
  const root = document.documentElement;
  // resolve from this script's own URL (js/ → img/), so it works live and on the dev server
  const src = new URL(`../img/${pick}`, document.currentScript.src).href;
  root.style.setProperty('--wall', `url("${src}")`);
  root.dataset.wall = pick;
  root.classList.add('wall-set');
})();
