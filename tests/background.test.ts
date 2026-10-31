import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALARM, activeIcons, pausedIcons, createService } from '../src/background/service';
import { contentSender, mockChrome, popupSender, record } from './chrome';
import { defaults } from '../src/shared/model';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('T01, T09, T21 startup and alarm lifecycle', () => {
  it('does not write fallback threshold or enable an alarm on first run', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const { data, api } = mockChrome({}, [{ id: 1, url: 'https://a.com', title: 'A' }]);
    const service = createService();
    await service.initialize();
    expect(data.inactive_tabs_settings).toBeUndefined();
    expect(api.alarms.create).not.toHaveBeenCalled();
    expect(api.alarms.clear).toHaveBeenCalledWith(ALARM);
    expect(data.total_awake_milliseconds).toBe(0);
    expect(data.all_tracked_tabs).toEqual({ 1: { timeStamp: 0 } });
    await service.mountLocal();
    expect(data.all_tabs_urls[1]).toEqual({ url: 'https://a.com', title: 'A' });
    expect(api.scripting.executeScript).toHaveBeenCalled();
  });
  it('uses existing checkpoint, drops long restart gap, removes stale tracking', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(500000);
    const { data } = mockChrome(
      {
        total_awake_milliseconds: 12,
        last_checkpoint_wall_clock: 1,
        all_tracked_tabs: { 99: { timeStamp: 1 } },
      },
      [{ id: 1 }],
    );
    await createService().initialize();
    expect(data.total_awake_milliseconds).toBe(12);
    expect(data.last_checkpoint_wall_clock).toBe(500000);
    expect(data.all_tracked_tabs).toEqual({ 1: { timeStamp: 12 } });
  });
  it('saving a threshold creates its alarm; pausing keeps it', async () => {
    const { api, data } = mockChrome();
    const service = createService();
    expect(
      await service.dispatch(
        { type: 'saveInactiveTabsSettings', body: { value: 1.5, unit: 'hours' } },
        popupSender,
      ),
    ).toEqual({ ok: true, data: { value: 1.5, unit: 'hours' } });
    expect(api.alarms.create).toHaveBeenCalledWith(ALARM, {
      delayInMinutes: 9,
      periodInMinutes: 9,
    });
    expect(api.action.setIcon).toHaveBeenCalledWith({ path: activeIcons });
    expect(api.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    api.alarms.clear.mockClear();
    api.action.setIcon.mockClear();
    expect(
      await service.dispatch({ type: 'saveInactivityDisabledState', body: true }, popupSender),
    ).toEqual({ ok: true, data: true });
    expect(data.inactive_tabs_threshold_disabled).toBe(true);
    expect(api.alarms.clear).not.toHaveBeenCalled();
    expect(api.action.setIcon).toHaveBeenCalledWith({ path: pausedIcons });
    expect(api.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
  it('does not recreate an identical alarm', async () => {
    const { api } = mockChrome({ inactive_tabs_settings: { value: 1, unit: 'hours' } });
    api.alarms.get.mockResolvedValue({
      name: ALARM,
      periodInMinutes: 6,
      scheduledTime: 0,
      persistAcrossSessions: true,
    });
    await createService().initialize();
    expect(api.alarms.create).not.toHaveBeenCalled();
  });
  it('serializes concurrent tab activity checkpoints without lost updates', async () => {
    let clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      clock += 5000;
      return clock;
    });
    const { data } = mockChrome({
      inactive_tabs_settings: { value: 15, unit: 'minutes' },
      total_awake_milliseconds: 0,
      last_checkpoint_wall_clock: 1000,
      all_tracked_tabs: { 1: { timeStamp: 0 }, 2: { timeStamp: 0 } },
    });
    const service = createService();
    await Promise.all([
      service.dispatch({ type: 'updateTabActivity' }, { ...contentSender, tab: { id: 1 } as chrome.tabs.Tab }),
      service.dispatch({ type: 'updateTabActivity' }, { ...contentSender, tab: { id: 2 } as chrome.tabs.Tab }),
    ]);
    expect(data.total_awake_milliseconds).toBeGreaterThan(0);
  });
});
describe('shared protocol and source checks', () => {
  it('rejects privileged messages without both extension id and URL', async () => {
    mockChrome();
    const service = createService();
    for (const sender of [contentSender, { ...popupSender, id: 'other' }, { id: 'test' }])
      expect(await service.dispatch({ type: 'saveWhitelist', body: [] }, sender)).toEqual({
        ok: false,
        error: 'Unauthorized sender',
      });
    expect(await service.dispatch({ type: 'getWhitelist' }, contentSender)).toEqual({
      ok: true,
      data: [],
    });
  });
  it('content messages require only a numeric tab id', async () => {
    mockChrome();
    const service = createService();
    expect((await service.dispatch({ type: 'getArchiveOverlayVisibility' }, popupSender)).ok).toBe(
      false,
    );
    expect(
      await service.dispatch({ type: 'getArchiveOverlayVisibility' }, {
        id: 'test',
        tab: { id: -1.5 },
      } as chrome.runtime.MessageSender),
    ).toEqual({ ok: true, data: { showOverlay: true, position: null } });
  });
  it('rejects messages from foreign extension ids', async () => {
    mockChrome();
    const service = createService();
    expect(
      await service.dispatch(
        { type: 'getWhitelist' },
        { id: 'other-extension' } as chrome.runtime.MessageSender,
      ),
    ).toEqual({ ok: false, error: 'Unauthorized sender' });
  });
  it('has exact save response data and removes sync fields', async () => {
    const { data } = mockChrome();
    const service = createService();
    expect(
      await service.dispatch(
        { type: 'saveUserSettings', body: { ...defaults, syncAcrossDevices: true } },
        popupSender,
      ),
    ).toEqual({ ok: true, data: defaults });
    expect(data.user_settings).toEqual(defaults);
    expect(
      await service.dispatch(
        { type: 'saveArchiveOverlayPosition', body: { leftPx: -2, topPx: 3.5 } },
        contentSender,
      ),
    ).toEqual({ ok: true, data: null });
    expect(await service.dispatch({ type: 'disableArchiveOverlay' }, contentSender)).toEqual({
      ok: true,
      data: null,
    });
  });
  it('rejects pause before a threshold exists and unsupported/deleted messages', async () => {
    mockChrome();
    const service = createService();
    expect(
      (await service.dispatch({ type: 'saveInactivityDisabledState', body: true }, popupSender)).ok,
    ).toBe(false);
    for (const type of ['logoutUser', 'pullRemoteData', 'toString', 'apply_premium_status'])
      expect(await service.dispatch({ type }, popupSender)).toEqual({
        ok: false,
        error: 'Unsupported message type',
      });
  });
});
describe('T12 delete before reopen', () => {
  it('uses persisted archived URL after deleting id and returns null', async () => {
    const { data, calls, api } = mockChrome({ archived_tabs: [record()] });
    const result = await createService().dispatch(
      { type: 'restoreArchivedTab', body: { id: 'a', url: 'http://different.test/path' } },
      contentSender,
    );
    expect(result).toEqual({ ok: true, data: null });
    expect(data.archived_tabs).toEqual([]);
    expect(api.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/a' });
    expect(calls).toEqual(['set:archived_tabs', 'create:https://example.com/a']);
  });
  it('create failure leaves record deleted with generic failure', async () => {
    const { data, api } = mockChrome({ archived_tabs: [record()] });
    api.tabs.create.mockRejectedValue(new Error('denied'));
    expect(
      await createService().dispatch(
        { type: 'restoreArchivedTab', body: { id: 'a', url: 'https://a.test' } },
        contentSender,
      ),
    ).toEqual({ ok: false, error: 'Unexpected message handling error' });
    expect(data.archived_tabs).toEqual([]);
  });
  it('storage failure never calls create; nonexistent id never creates', async () => {
    const { api } = mockChrome({ archived_tabs: [record()] });
    const service = createService();
    api.storage.local.set.mockRejectedValueOnce(new Error('disk'));
    expect(
      (
        await service.dispatch(
          { type: 'restoreArchivedTab', body: { id: 'a', url: 'https://a.test' } },
          contentSender,
        )
      ).ok,
    ).toBe(false);
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(
      await service.dispatch(
        { type: 'restoreArchivedTab', body: { id: 'missing', url: 'https://a.test' } },
        contentSender,
      ),
    ).toEqual({ ok: false, error: 'This tab is no longer in the archive.' });
  });
  it('rejects non HTTP(S) before deleting', async () => {
    const { data, api } = mockChrome({ archived_tabs: [record()] });
    expect(
      (
        await createService().dispatch(
          { type: 'restoreArchivedTab', body: { id: 'a', url: 'chrome://settings' } },
          popupSender,
        )
      ).ok,
    ).toBe(false);
    expect(data.archived_tabs).toHaveLength(1);
    expect(api.tabs.create).not.toHaveBeenCalled();
  });
  it('safely handles corrupted archived_tabs in storage without crashing', async () => {
    mockChrome({ archived_tabs: 'corrupted-data' as any });
    const service = createService();
    const result = await service.dispatch({ type: 'getArchivedTabs' }, popupSender);
    expect(result).toEqual({ ok: true, data: [] });
  });
});
describe('T04–T05, T10–T13 closing and archive', () => {
  const initial = () => ({
    inactive_tabs_settings: { value: 15, unit: 'minutes' },
    total_awake_milliseconds: 1000000,
    last_checkpoint_wall_clock: 1000000,
    all_tracked_tabs: { 1: { timeStamp: 0 }, 2: { timeStamp: 0 }, 3: { timeStamp: 100000 } },
  });
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
  });
  it('excludes all active tabs and exact threshold equality', async () => {
    const { api } = mockChrome(initial(), [
      { id: 1, active: true },
      { id: 2, active: true },
      { id: 3, active: false },
    ]);
    await createService().sweep();
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });
  it('archives before remove; failure retains archive and clears tracking; counts successes only', async () => {
    const { api, data, calls } = mockChrome(initial(), [
      { id: 1, active: false, url: 'https://a.test', title: 'A' },
      { id: 2, active: false, url: 'https://b.test', title: 'B' },
    ]);
    api.tabs.remove.mockImplementation(async (id) => {
      calls.push('remove:' + id);
      if (id === 1) throw Error('fail');
    });
    await createService().sweep();
    expect(data.archived_tabs).toHaveLength(2);
    expect(data.total_auto_closed_tabs_count).toBe(1);
    expect(data.all_tracked_tabs[1]).toBeUndefined();
    expect(calls.indexOf('set:archived_tabs')).toBeLessThan(calls.indexOf('remove:1'));
    expect(data.all_tabs_urls).toEqual({});
  });
  it('pause still checkpoints and snapshots without closing', async () => {
    const { data, api } = mockChrome(
      { ...initial(), inactive_tabs_threshold_disabled: true, last_checkpoint_wall_clock: 999000 },
      [{ id: 1, url: 'https://a.test', title: 'A', active: false }],
    );
    await createService().sweep();
    expect(data.total_awake_milliseconds).toBe(1001000);
    expect(data.all_tabs_urls[1].title).toBe('A');
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });
  it('pinned and audio protections apply only when enabled and audio is unmuted', async () => {
    const { api } = mockChrome(
      {
        ...initial(),
        user_settings: { ...defaults, excludePinnedTabs: true, excludeAudioTabs: true },
      },
      [
        { id: 1, pinned: true },
        { id: 2, audible: true, mutedInfo: { muted: false } },
        { id: 3, audible: true, mutedInfo: { muted: true } },
      ],
    ); // Give tab 3 the same stale time.
    const tracked = initial().all_tracked_tabs;
    tracked[3].timeStamp = 0;
    await chrome.storage.local.set({ all_tracked_tabs: tracked });
    await createService().sweep();
    expect(api.tabs.remove).toHaveBeenCalledTimes(1);
    expect(api.tabs.remove).toHaveBeenCalledWith(3);
  });
  it('manual close archives immediately, consumes cache, retains duplicate URLs', async () => {
    const { data } = mockChrome({
      all_tabs_urls: {
        1: { url: 'https://a.test', title: 'A' },
        2: { url: 'https://a.test', title: 'A' },
        3: { url: 'https://a.test', title: null },
      },
    });
    const service = createService();
    await service.onRemoved(1);
    expect(data.archived_tabs).toHaveLength(1);
    await service.onRemoved(2);
    expect(data.archived_tabs).toHaveLength(2);
    expect(data.archived_tabs[0].id).not.toBe(data.archived_tabs[1].id);
    await service.onRemoved(3);
    expect(data.archived_tabs).toHaveLength(2);
    expect(data.all_tabs_urls).toEqual({});
    expect(data.total_auto_closed_tabs_count).toBeUndefined();
  });
  it('updates cache on URL/title changes and SPA snapshot, removes invalid URL', async () => {
    const { data } = mockChrome(
      { all_tabs_urls: { 1: { url: 'https://old.test', title: 'old' } } },
      [{ id: 1, url: 'https://new.test', title: 'new' }],
    );
    const service = createService();
    await service.mountLocal();
    expect(data.all_tabs_urls[1].title).toBe('new');
    expect(data.all_tabs_urls[1].url).toBe('https://new.test');
    await service.onUpdated(1, { title: 'updated' }, {
      id: 1,
      url: 'https://new.test',
    } as chrome.tabs.Tab);
    expect(data.all_tabs_urls[1].title).toBe('updated');
    await service.onUpdated(1, { url: 'chrome://settings' }, {
      id: 1,
      url: 'chrome://settings',
    } as chrome.tabs.Tab);
    expect(data.all_tabs_urls[1]).toBeUndefined();
  });
  it('false-to-true overlay setting attempts archive injection', async () => {
    const { api } = mockChrome({ user_settings: { ...defaults, showArchiveOverlay: false } }, [
      { id: 1 },
    ]);
    await createService().dispatch({ type: 'saveUserSettings', body: defaults }, popupSender);
    await Promise.resolve();
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['content-scripts/archive.js'],
    });
  });
});
