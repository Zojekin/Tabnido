import { send } from '../shared/protocol';
const key = '__tabsenceActivityTrackerInitialized';
type ActivityWindow = Window & { __tabsenceActivityTrackerInitialized?: boolean };
export function startActivity() {
  const current = window as ActivityWindow;
  if (current[key]) return;
  current[key] = true;
  const capture = { capture: true },
    passive = { passive: true, capture: true };
  const direct = ['keydown', 'pointerdown', 'drag'],
    scroll = ['scroll', 'wheel', 'touchmove'];
  let last = 0;
  const detach = () => {
    direct.forEach((name) => window.removeEventListener(name, activity, capture));
    scroll.forEach((name) => window.removeEventListener(name, activity, passive));
    window.removeEventListener('pointermove', move, passive);
    document.removeEventListener('visibilitychange', activity);
    current[key] = false;
  };
  const activity = () => {
    if (!chrome.runtime?.id) {
      detach();
      return;
    }
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - last < 15000) return;
    last = now;
    void send('updateTabActivity');
  };
  const move = (event: PointerEvent) => {
    if (event.buttons !== 0) activity();
  };
  direct.forEach((name) => window.addEventListener(name, activity, capture));
  scroll.forEach((name) => window.addEventListener(name, activity, passive));
  window.addEventListener('pointermove', move, passive);
  document.addEventListener('visibilitychange', activity);
  return detach;
}
startActivity();
