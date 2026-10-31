import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, PAGE_SIZE } from '../src/popup/App';
import { createService } from '../src/background/service';
import { defaults } from '../src/shared/model';
import { mockChrome, popupSender, record } from './chrome';
let root: Root, host: HTMLDivElement;
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const click = async (element: Element) =>
  act(async () => {
    (element as HTMLElement).click();
    await settle();
  });
const byText = (selector: string, text: string) =>
  [...host.querySelectorAll(selector)].find((node) => node.textContent === text)!;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe('T01, T14, T17–T19 popup DOM without a browser', () => {
  async function mount(initial: Record<string, unknown> = {}, ui = 'en-US') {
    const mock = mockChrome(initial),
      service = createService();
    mock.api.i18n.getUILanguage.mockReturnValue(ui);
    mock.api.runtime.sendMessage.mockImplementation((m) => service.dispatch(m, popupSender));
    await act(async () => {
      root.render(<App />);
      await settle();
    });
    return mock;
  }
  it('first run shows one hour without saving and exposes four local sections without account or email', async () => {
    const { api, data } = await mount();
    expect((host.querySelector('input[type=number]') as HTMLInputElement).value).toBe('1');
    expect(host.querySelectorAll('nav button')).toHaveLength(4);
    expect(data.inactive_tabs_settings).toBeUndefined();
    expect(
      api.runtime.sendMessage.mock.calls.some(([m]) => m.type === 'saveInactiveTabsSettings'),
    ).toBe(false);
    expect(host.querySelectorAll('a')).toHaveLength(0);
    expect(host.textContent).not.toMatch(/Pro|Login|refund|feedback/);
    expect(document.documentElement.lang).toBe('en');
    await click(host.querySelector('[aria-label="Increase duration"]')!);
    expect(data.inactive_tabs_settings).toEqual({ value: 2, unit: 'hours' });
    expect(api.alarms.create).toHaveBeenCalled();
  });
  it('Chinese Chrome defaults to simplified Chinese and manual English persists across reopening', async () => {
    const { data } = await mount({}, 'zh-TW');
    expect(host.textContent).toContain('闲置关闭时长');
    const select = host.querySelector('header select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'en';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    });
    expect(data.ui_language).toBe('en');
    expect(host.textContent).toContain('Close inactive tabs');
    await act(async () => {
      root.unmount();
      root = createRoot(host);
      root.render(<App />);
      await settle();
    });
    expect(document.documentElement.lang).toBe('en');
  });
  it('archive renders newest first, preserves titles and URLs, and guards the clicked row', async () => {
    const { api } = await mount({ archived_tabs: [record('old', 1), record('new', 2)] });
    await click(byText('nav button', 'Archive'));
    expect(host.querySelector('.row-title')?.textContent).toBe('Title new');
    expect(host.querySelector('.row-url')?.textContent).toBe('example.com/new');
    let complete!: (v: unknown) => void;
    api.runtime.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const button = host.querySelector('.archive-row button')!;
    await click(button);
    await click(button);
    expect(
      api.runtime.sendMessage.mock.calls.filter(([m]) => m.type === 'restoreArchivedTab'),
    ).toHaveLength(1);
    await act(async () => {
      complete({ ok: false, error: 'raw error' });
      await settle();
    });
    expect(host.textContent).toContain('Could not reopen this tab.');
    expect(host.textContent).not.toContain('raw error');
  });
  it('settings retain original default booleans and persist toggles immediately', async () => {
    const { data } = await mount();
    await click(byText('nav button', 'Settings'));
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(inputs.map((n) => n.checked)).toEqual([false, false, true]);
    await click(inputs[0]);
    expect(data.user_settings).toEqual({ ...defaults, excludePinnedTabs: true });
  });
  it('archive progressively renders 30 items per page and loads more on bottom scroll', async () => {
    expect(PAGE_SIZE).toBe(30);
    const records = Array.from({ length: 70 }, (_, i) => record(`tab-${i}`, i));
    await mount({ archived_tabs: records });
    await click(byText('nav button', 'Archive'));
    // Initially only PAGE_SIZE (30) items are rendered
    expect(host.querySelectorAll('.archive-row')).toHaveLength(30);
    expect(host.querySelector('.archive-list .loading')?.textContent).toBe('Loading…');

    // Simulate scroll to near-bottom (scrollTop + clientHeight >= scrollHeight - 40)
    const list = host.querySelector('.archive-list') as HTMLDivElement;
    Object.defineProperty(list, 'scrollTop', { value: 600, configurable: true, writable: true });
    Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true, writable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 900, configurable: true, writable: true });
    await act(async () => {
      list.dispatchEvent(new Event('scroll'));
      await settle();
    });
    // Now 60 items should be rendered
    expect(host.querySelectorAll('.archive-row')).toHaveLength(60);

    // Search input resets visibleCount back to 30
    const search = host.querySelector('.search') as HTMLInputElement;
    await act(async () => {
      search.value = 'tab';
      search.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    });
    expect(host.querySelectorAll('.archive-row')).toHaveLength(30);

    // Tab switch resets visibleCount back to 30
    await click(byText('nav button', 'Settings'));
    await click(byText('nav button', 'Archive'));
    expect(host.querySelectorAll('.archive-row')).toHaveLength(30);
  });
  it('displays localized restore error messages for mapped archive errors in English and Chinese', async () => {
    // English
    const { api } = await mount({ archived_tabs: [record('1')] });
    await click(byText('nav button', 'Archive'));
    let complete!: (v: unknown) => void;
    api.runtime.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const button = host.querySelector('.archive-row button')!;
    await click(button);
    await act(async () => {
      complete({ ok: false, error: 'This tab is no longer in the archive.' });
      await settle();
    });
    expect(host.querySelector('.toast')?.textContent).toBe('This tab is no longer in the archive.');

    // Chinese
    await act(async () => {
      root.unmount();
      root = createRoot(host);
    });
    const zhMount = await mount({ archived_tabs: [record('2')] }, 'zh-CN');
    await click(byText('nav button', '归档'));
    let zhComplete!: (v: unknown) => void;
    zhMount.api.runtime.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          zhComplete = resolve;
        }),
    );
    const zhButton = host.querySelector('.archive-row button')!;
    await click(zhButton);
    await act(async () => {
      zhComplete({ ok: false, error: 'This tab is no longer in the archive.' });
      await settle();
    });
    expect(host.querySelector('.toast')?.textContent).toBe('该标签页已不在归档中。');

    // Test cannotReopen error in Chinese
    await click(zhButton);
    await act(async () => {
      zhComplete({ ok: false, error: 'This tab cannot be reopened.' });
      await settle();
    });
    expect(host.querySelector('.toast')?.textContent).toBe('该标签页无法被重新打开。');

    // Test invalidRestore error in Chinese
    await click(zhButton);
    await act(async () => {
      zhComplete({ ok: false, error: 'Invalid restore request.' });
      await settle();
    });
    expect(host.querySelector('.toast')?.textContent).toBe('无效的恢复请求。');
  });

  it('first-run switch activates the displayed duration without an implicit startup save', async () => {
    const { data } = await mount();
    expect(data.inactive_tabs_settings).toBeUndefined();
    await click(host.querySelector('[role=switch]')!);
    expect(data.inactive_tabs_settings).toEqual({ value: 1, unit: 'hours' });
    expect(data.inactive_tabs_threshold_disabled).toBe(false);
  });
  it('a failed duration autosave restores the last persisted value and reports an error', async () => {
    const { api, data } = await mount({ inactive_tabs_settings: { value: 4, unit: 'hours' } });
    api.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'storage unavailable' });
    await click(host.querySelector('[aria-label="Increase duration"]')!);
    expect((host.querySelector('.duration') as HTMLInputElement).value).toBe('4');
    expect(data.inactive_tabs_settings).toEqual({ value: 4, unit: 'hours' });
    expect(host.querySelector('.toast')?.textContent).toContain('Could not save');
  });
  it('a failed settings save rolls back the switch rather than displaying an unsaved state', async () => {
    const { api } = await mount();
    await click(byText('nav button', 'Settings'));
    api.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'storage unavailable' });
    await click(host.querySelector('[role=switch]')!);
    expect((host.querySelector('[role=switch]') as HTMLInputElement).checked).toBe(false);
    expect(host.querySelector('.toast')?.textContent).toContain('Could not save');
  });
  it('inline match mode changes persist without a Save button', async () => {
    const { data } = await mount({
      whitelisted_domains: [{ id: '1', domain: 'example.com', matchMode: 'mode_subdomain' }],
    });
    await click(byText('nav button', 'Whitelist'));
    await click(host.querySelector('.mode-trigger')!);
    await click(byText('[role=menuitemradio]', 'Exact'));
    expect(data.whitelisted_domains).toEqual([
      { id: '1', domain: 'example.com', matchMode: 'mode_exact' },
    ]);
    expect([...host.querySelectorAll('button')].some((el) => el.textContent === 'Save')).toBe(
      false,
    );
  });
});
