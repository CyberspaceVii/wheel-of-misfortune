// The wall clock, top right: day, date and system time, 12-hour with AM/PM.
// Ticks on each minute boundary and re-syncs when the tab comes back (timers sleep in the background).

export function initClock(root) {
  const t = root.querySelector('.clock-t');
  const ap = root.querySelector('.clock-ap');
  const d = root.querySelector('.clock-d');
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  let to = null;

  function tick() {
    const now = new Date();
    const parts = fmt.formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
    t.textContent = `${get('hour')}:${get('minute')}`;
    ap.textContent = get('dayPeriod').toUpperCase();
    d.textContent = day.format(now);   // "Thu, Nov 5"; the minute tick rolls it over at midnight
    root.dateTime = now.toISOString();
    clearTimeout(to);
    to = setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
}
