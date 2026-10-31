import { afterEach, expect, it, vi } from 'vitest';
import { mockChrome, popupSender, record } from './chrome';
import { createService } from '../src/background/service';
import { queue } from '../src/storage/local';
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('registers original Chrome listeners synchronously, without activation/external listeners', async () => {
  vi.resetModules();
  const { api, data } = mockChrome({}, [{ id: 1, url: 'https://a.test', title: 'A' }]);
  await import('../src/background/index');
  expect(api.runtime.onMessage.listeners.size).toBe(1);
  expect(api.tabs.onCreated.listeners.size).toBe(1);
  expect(api.tabs.onUpdated.listeners.size).toBe(1);
  expect(api.tabs.onRemoved.listeners.size).toBe(1);
  expect(api.runtime).not.toHaveProperty('onMessageExternal');
  expect(api.tabs).not.toHaveProperty('onActivated');
  api.runtime.onInstalled.emit({ reason: 'install' });
  await settle();
  expect(
    api.scripting.executeScript.mock.calls.some(([value]) =>
      value.files.includes('content-scripts/activity.js'),
    ),
  ).toBe(true);
  expect(
    api.scripting.executeScript.mock.calls.some(([value]) =>
      value.files.includes('content-scripts/archive.js'),
    ),
  ).toBe(true);
  expect(data.all_tabs_urls[1].title).toBe('A');
  const respond = vi.fn();
  const returned = api.runtime.onMessage.emit({ type: 'getWhitelist' }, popupSender, respond);
  expect(returned).toEqual([true]);
  await settle();
  expect(respond).toHaveBeenCalledWith({ ok: true, data: [] });
});
it('independent update queue survives rejection and keeps later writes ordered', async () => {
  const update = queue(),
    calls: number[] = [];
  const first = update(async () => {
    calls.push(1);
    throw new Error('failure');
  });
  const second = update(async () => {
    calls.push(2);
  });
  await expect(first).rejects.toThrow('failure');
  await second;
  expect(calls).toEqual([1, 2]);
});
it('prearchive consumes cache so later automatic removal event does not duplicate records', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const { api, data } = mockChrome(
    {
      inactive_tabs_settings: { value: 15, unit: 'minutes' },
      total_awake_milliseconds: 1000000,
      last_checkpoint_wall_clock: 1000000,
      all_tracked_tabs: { 1: { timeStamp: 0 } },
    },
    [{ id: 1, active: false, url: 'https://a.test', title: 'A' }],
  );
  const service = createService();
  let removal: Promise<void> | undefined;
  api.tabs.remove.mockImplementation(async (id) => {
    removal = service.onRemoved(id);
  });
  await service.sweep();
  await vi.advanceTimersByTimeAsync(100);
  await removal;
  expect(data.archived_tabs).toHaveLength(1);
  expect(data.total_auto_closed_tabs_count).toBe(1);
});
it('no backend restore lock: archive queue alone resolves duplicate restore ids', async () => {
  const { api, data } = mockChrome({ archived_tabs: [record()] });
  const service = createService();
  const request = { type: 'restoreArchivedTab', body: { id: 'a', url: 'https://a.test' } };
  const results = await Promise.all([
    service.dispatch(request, popupSender),
    service.dispatch(request, popupSender),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(api.tabs.create).toHaveBeenCalledOnce();
  expect(data.archived_tabs).toEqual([]);
});
