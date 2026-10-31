import type { Position } from '../shared/model';
export function attachDrag(
  toggle: HTMLButtonElement,
  apply: (p: Position) => Position,
  start: () => void,
  end: (p: Position) => void,
) {
  let pointer: number | null = null,
    x = 0,
    y = 0,
    left = 0,
    top = 0,
    dragging = false,
    consume = false,
    position: Position | null = null,
    pendingPosition: Position | null = null,
    rafId: number | null = null;
  const cancelRaf = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelRaf();
    pendingPosition = null;
    const rect = toggle.getBoundingClientRect();
    pointer = e.pointerId;
    x = e.clientX;
    y = e.clientY;
    left = rect.left;
    top = rect.top;
    position = null;
    dragging = false;
  };
  const move = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    const dx = e.clientX - x,
      dy = e.clientY - y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 4) return;
      dragging = true;
      toggle.setPointerCapture(e.pointerId);
      toggle.classList.add('dragging');
      start();
    }
    pendingPosition = { leftPx: left + dx, topPx: top + dy };
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (pendingPosition) {
          position = apply(pendingPosition);
          pendingPosition = null;
        }
      });
    }
  };
  const up = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    pointer = null;
    if (dragging) {
      dragging = false;
      consume = true;
      toggle.classList.remove('dragging');
      cancelRaf();
      if (pendingPosition) {
        position = apply(pendingPosition);
        pendingPosition = null;
      }
      if (position) end(position);
    }
  };
  const cancel = (e: PointerEvent) => {
    if (pointer === e.pointerId) {
      pointer = null;
      dragging = false;
      toggle.classList.remove('dragging');
      cancelRaf();
      pendingPosition = null;
    }
  };
  toggle.addEventListener('pointerdown', down);
  toggle.addEventListener('pointermove', move);
  toggle.addEventListener('pointerup', up);
  toggle.addEventListener('pointercancel', cancel);
  return {
    consumeClick: () => {
      const value = consume;
      consume = false;
      return value;
    },
    detach: () => {
      cancelRaf();
      pendingPosition = null;
      toggle.removeEventListener('pointerdown', down);
      toggle.removeEventListener('pointermove', move);
      toggle.removeEventListener('pointerup', up);
      toggle.removeEventListener('pointercancel', cancel);
    },
  };
}
