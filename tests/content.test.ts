import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachDrag } from '../src/content/drag';
import { mockChrome, record } from './chrome';
import { en, resolveLanguage, text } from '../src/i18n';
import { send } from '../src/shared/protocol';
const settle = async (ms = 0) => {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.getElementById('tabsence-archive-overlay')?.remove();
  delete (window as any).__tabsenceArchiveOverlayInitialized;
  delete (window as any).__tabsenceActivityTrackerInitialized;
});
describe('T08 activity event and throttle boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
  });
  it('does not send at startup; only dragging pointermove counts, throttle is leading edge', async () => {
    const { api } = mockChrome();
    api.runtime.sendMessage.mockResolvedValue({ ok: true, data: null });
    const { startActivity } = await import('../src/content/activity');
    expect(api.runtime.sendMessage).not.toHaveBeenCalled();
    window.dispatchEvent(new PointerEvent('pointermove', { buttons: 0 }));
    expect(api.runtime.sendMessage).not.toHaveBeenCalled();
    window.dispatchEvent(new PointerEvent('pointermove', { buttons: 1 }));
    expect(api.runtime.sendMessage).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('keydown'));
    expect(api.runtime.sendMessage).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(1015000);
    window.dispatchEvent(new Event('wheel'));
    expect(api.runtime.sendMessage).toHaveBeenCalledTimes(2);
    (window as any).__tabsenceActivityTrackerInitialized = false; // Remove first listener through context invalidation.
    api.runtime.id = '';
    window.dispatchEvent(new Event('scroll'));
    api.runtime.id = 'test';
    startActivity();
    api.runtime.id = '';
    window.dispatchEvent(new Event('scroll'));
  });
  it.each(['keydown', 'pointerdown', 'drag', 'scroll', 'wheel', 'touchmove', 'visibilitychange'])(
    'listens to %s and hidden events do not consume throttle window',
    async (name) => {
      const { api } = mockChrome();
      api.runtime.sendMessage.mockResolvedValue({ ok: true, data: null });
      await import('../src/content/activity');
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      (name === 'visibilitychange' ? document : window).dispatchEvent(new Event(name));
      expect(api.runtime.sendMessage).not.toHaveBeenCalled();
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      vi.spyOn(Date, 'now').mockReturnValue(1001000);
      window.dispatchEvent(new Event('keydown'));
      expect(api.runtime.sendMessage).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event('keydown'));
      expect(api.runtime.sendMessage).toHaveBeenCalledTimes(1);
      vi.spyOn(Date, 'now').mockReturnValue(1016001);
      (name === 'visibilitychange' ? document : window).dispatchEvent(new Event(name));
      expect(api.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'updateTabActivity',
        body: undefined,
      });
      api.runtime.id = '';
      window.dispatchEvent(new Event('keydown'));
    },
  );
});
describe('T15 drag', () => {
  it('starts at four pixels, persists on release, consumes one click', () => {
    const toggle = document.createElement('button');
    toggle.setPointerCapture = vi.fn();
    const apply = vi.fn((p) => p),
      start = vi.fn(),
      end = vi.fn();
    const drag = attachDrag(toggle, apply, start, end);
    const pointer = (type: string, x: number) =>
      toggle.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          clientX: x,
          clientY: 0,
        }),
      );
    pointer('pointerdown', 0);
    pointer('pointermove', 3);
    expect(start).not.toHaveBeenCalled();
    pointer('pointermove', 4);
    expect(start).toHaveBeenCalledOnce();
    pointer('pointerup', 4);
    expect(end).toHaveBeenCalledWith({ leftPx: 4, topPx: 0 });
    expect(drag.consumeClick()).toBe(true);
    expect(drag.consumeClick()).toBe(false);
    drag.detach();
  });
});
describe('T14–T18 overlay DOM with simulated Chrome', () => {
  let roots: ShadowRoot[];
  beforeEach(() => {
    vi.resetModules();
    roots = [];
    const original = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
      const root = original.call(this, init);
      roots.push(root);
      return root;
    });
  });
  async function mounted() {
    const mock = mockChrome();
    mock.api.runtime.sendMessage.mockImplementation(async ({ type }) =>
      type === 'getArchiveOverlayVisibility'
        ? { ok: true, data: { showOverlay: true, position: null } }
        : type === 'getArchivedTabs'
          ? { ok: true, data: [record('old'), record('new')] }
          : { ok: false, error: 'failure' },
    );
    const module = await import('../src/content/archive');
    await settle();
    return { ...mock, module, root: roots[0] };
  }
  it('uses closed shadow, reversed order, trimmed search, title fallback, and no forced remount', async () => {
    const { root, module, changes } = await mounted();
    const host = document.getElementById('tabsence-archive-overlay')!;
    expect(host.shadowRoot).toBeNull();
    expect(root.querySelector('.row-title')?.textContent).toBe('Title new');
    expect(document.activeElement?.tagName).not.toBe('INPUT');
    const search = root.querySelector('input')!;
    search.value = ' TITLE OLD ';
    search.dispatchEvent(new Event('input'));
    await settle(160);
    expect(root.querySelectorAll('.row')).toHaveLength(1);
    changes.emit({ archived_tabs: { newValue: [{ ...record(), title: '' }] } }, 'local');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await settle(160);
    expect(root.querySelector('.row-title')?.textContent).toBe('https://example.com/a');
    module.startArchive();
    await settle();
    expect(roots).toHaveLength(1);
    changes.emit({ user_settings: { newValue: { showArchiveOverlay: false } } }, 'local');
    expect(host.isConnected).toBe(false);
    changes.emit({ ui_language: { newValue: 'zh-CN' } }, 'local');
    expect(document.getElementById('tabsence-archive-overlay')).toBeNull();
  });
  it('hide tears down even if messaging rejects; mounted language updates immediately', async () => {
    const { root, changes, api } = await mounted();
    const search = root.querySelector('input')!;
    changes.emit({ ui_language: { newValue: 'zh-CN' } }, 'local');
    expect(search.placeholder).toBe(text('zh-CN', 'search'));
    expect(root.host.getAttribute('lang')).toBe('zh-CN');
    api.runtime.sendMessage.mockRejectedValue(new Error('offline'));
    (root.querySelector('.hide-button') as HTMLButtonElement).click();
    await settle();
    expect(root.host.isConnected).toBe(false);
  });
  it('outside pointer closes, fullscreen hides host and restores it, Escape has no added handler', async () => {
    const { root, changes } = await mounted();
    const toggle = root.querySelector('.toggle') as HTMLButtonElement,
      panel = root.querySelector('.panel')!;
    toggle.click();
    expect(panel.classList.contains('open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.classList.contains('open')).toBe(true);
    document.dispatchEvent(new Event('pointerdown'));
    expect(panel.classList.contains('open')).toBe(false);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(document.body);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect((root.host as HTMLElement).style.display).toBe('none');
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(null);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect((root.host as HTMLElement).style.display).toBe('');
    changes.emit({ user_settings: { newValue: { showArchiveOverlay: false } } }, 'local');
  });
  it('overlay restore uses existing shared in-flight guard and generic error text', async () => {
    const { root, api, changes } = await mounted();
    let resolve!: (value: unknown) => void;
    api.runtime.sendMessage.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const row = root.querySelector('.row') as HTMLButtonElement;
    row.click();
    row.click();
    expect(
      api.runtime.sendMessage.mock.calls.filter(([m]) => m.type === 'restoreArchivedTab'),
    ).toHaveLength(1);
    resolve({ ok: false, error: 'Internal failure' });
    await settle();
    expect(root.querySelector('.status')?.textContent).toBe('Could not reopen this tab.');
    changes.emit({ user_settings: { newValue: { showArchiveOverlay: false } } }, 'local');
  });
});
describe('language and transport', () => {
  it.each(['zh', 'zh-CN', 'zh-TW', 'ZH-HK'])(
    'Chinese Chrome %s defaults to simplified Chinese',
    (ui) => expect(resolveLanguage(undefined, ui)).toBe('zh-CN'),
  );
  it('manual choice wins and every English key has a Chinese translation', () => {
    expect(resolveLanguage('en', 'zh-CN')).toBe('en');
    expect(resolveLanguage(undefined, 'de-DE')).toBe('en');
    for (const key of Object.keys(en) as (keyof typeof en)[])
      expect(text('zh-CN', key).length).toBeGreaterThan(0);
  });
  it('empty and rejected message response keep original failure envelopes', async () => {
    const { api } = mockChrome();
    api.runtime.sendMessage.mockResolvedValue(undefined);
    expect(await send('getWhitelist')).toEqual({
      ok: false,
      error: 'No response from background worker',
    });
    api.runtime.sendMessage.mockRejectedValue(new Error('no'));
    expect(await send('getWhitelist')).toEqual({
      ok: false,
      error: 'Failed to send runtime message',
    });
  });
});
