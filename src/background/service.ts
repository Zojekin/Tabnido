import {
  awakeDelta,
  cropArchive,
  formatBadgeText,
  matches,
  minutes,
  period,
  validPosition,
  validUrl,
  validateThreshold,
  validateWhitelist,
} from '../core/rules';
import {
  defaults,
  type ArchivedTab,
  type Position,
  type Settings,
  type StoredData,
} from '../shared/model';
import {
  allowed,
  fail,
  ok,
  type Messages,
  type MessageType,
  type Result,
} from '../shared/protocol';
import { queue, read, write } from '../storage/local';

export const ALARM = 'awake_time_checkpoint_and_sweep';
export function createService() {
  const trackedQueue = queue(),
    archiveQueue = queue(),
    cacheQueue = queue(),
    checkpointQueue = queue();
  const updateTracked = (change: (data: StoredData['all_tracked_tabs']) => void) =>
    trackedQueue(async () => {
      const data = (await read('all_tracked_tabs')) ?? {};
      change(data);
      await write('all_tracked_tabs', data);
    });
  const updateArchive = (change: (data: ArchivedTab[]) => ArchivedTab[]) =>
    archiveQueue(async () => {
      const current = await read('archived_tabs');
      const safe = Array.isArray(current) ? current : [];
      await write('archived_tabs', cropArchive(change(safe)));
    });
  const updateCache = (change: (data: StoredData['all_tabs_urls']) => void | Promise<void>) =>
    cacheQueue(async () => {
      const data = (await read('all_tabs_urls')) ?? {};
      await change(data);
      await write('all_tabs_urls', data);
    });
  const settings = async (): Promise<Settings> => ({
    ...defaults,
    ...((await read('user_settings')) ?? {}),
  });
  const checkpoint = () =>
    checkpointQueue(async () => {
      // Match rl -> tl -> nl: read the threshold before capturing the wall clock.
      const threshold = await read('inactive_tabs_settings');
      const max = period(threshold ? minutes(threshold) : 15) * 1.6 * 60 * 1000;
      const now = Date.now();
      const values = await chrome.storage.local.get([
        'total_awake_milliseconds',
        'last_checkpoint_wall_clock',
      ]);
      const total =
        typeof values.total_awake_milliseconds === 'number' ? values.total_awake_milliseconds : 0;
      const last =
        typeof values.last_checkpoint_wall_clock === 'number'
          ? values.last_checkpoint_wall_clock
          : null;
      const next = total + awakeDelta(last === null ? 0 : now - last, max);
      await chrome.storage.local.set({
        total_awake_milliseconds: next,
        last_checkpoint_wall_clock: now,
      });
      return next;
    });
  async function updateBadge() {
    if (!chrome.action) return;
    try {
      const [threshold, disabled] = await Promise.all([
        read('inactive_tabs_settings'),
        read('inactive_tabs_threshold_disabled'),
      ]);
      const isPaused = disabled === true || !threshold;
      const text = formatBadgeText(threshold, isPaused);
      const color = isPaused ? '#747474' : '#111111';
      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color });
      if (typeof (chrome.action as any).setBadgeTextColor === 'function') {
        await (chrome.action as any).setBadgeTextColor({ color: '#ffffff' });
      }
    } catch {
      /* Ignored when running outside Chrome */
    }
  }
  async function ensureAlarm() {
    const threshold = await read('inactive_tabs_settings');
    if (!threshold) {
      await chrome.alarms.clear(ALARM);
      return;
    }
    const interval = period(minutes(threshold)),
      alarm = await chrome.alarms.get(ALARM);
    if (alarm?.periodInMinutes === interval) return;
    if (alarm) await chrome.alarms.clear(ALARM);
    await chrome.alarms.create(ALARM, { delayInMinutes: interval, periodInMinutes: interval });
  }
  async function alignTabs(tabs?: chrome.tabs.Tab[], awake?: number) {
    const current = tabs ?? (await chrome.tabs.query({})),
      ids = new Set(current.map((t) => t.id).filter((id) => typeof id === 'number'));
    const time = awake ?? (await checkpoint());
    await updateTracked((data) => {
      for (const id of ids) data[String(id)] ??= { timeStamp: time };
      for (const id of Object.keys(data)) if (!ids.has(Number(id))) delete data[id];
    });
  }
  async function snapshot(tabs?: chrome.tabs.Tab[]) {
    const current = tabs ?? (await chrome.tabs.query({})),
      ids = new Set(current.map((t) => t.id));
    await updateCache((data) => {
      for (const { id, url, title } of current) {
        if (typeof id !== 'number') continue;
        if (url && !validUrl(url)) {
          delete data[id];
          continue;
        }
        if (!url || !title || !validUrl(url)) continue;
        const old = data[id];
        if (!old || old.url !== url || old.title !== title) {
          data[id] = { url, title };
        }
      }
      for (const id of Object.keys(data)) if (!ids.has(Number(id))) delete data[id];
    });
  }
  async function archive(ids: number[]) {
    if (!ids.length) return;
    await updateCache(async (data) => {
      const records: ArchivedTab[] = [],
        now = Date.now();
      for (const id of ids) {
        const { url, title } = data[id] ?? { url: null, title: null };
        if (url !== null && title !== null && validUrl(url))
          records.push({ id: crypto.randomUUID(), url, title, closedAt: now });
        delete data[id];
      }
      if (records.length) await updateArchive((old) => [...old, ...records]);
    });
  }
  async function inject(name: 'activity' | 'archive') {
    const files = (chrome.runtime.getManifest().content_scripts ?? [])
      .flatMap((s) => s.js ?? [])
      .filter((f) => f.includes(name));
    if (!files.length) return;
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined) return;
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
        } catch {
          /* Restricted pages keep Chrome's failure behavior. */
        }
      }),
    );
  }
  async function saveSettings(input: unknown): Promise<Result<Settings>> {
    if (!input || typeof input !== 'object') return fail('Invalid user settings.');
    const { excludePinnedTabs, excludeAudioTabs, showArchiveOverlay } = input as Settings;
    if (
      [excludePinnedTabs, excludeAudioTabs, showArchiveOverlay].some((v) => typeof v !== 'boolean')
    )
      return fail('Invalid user settings.');
    const data = { excludePinnedTabs, excludeAudioTabs, showArchiveOverlay },
      previous = await settings();
    await write('user_settings', data);
    if (!previous.showArchiveOverlay && showArchiveOverlay) void inject('archive').catch(() => {});
    return ok(data);
  }
  async function count() {
    const n = await read('total_auto_closed_tabs_count');
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
  }
  async function sweep() {
    const awake = await checkpoint(),
      tabs = await chrome.tabs.query({});
    await alignTabs(tabs, awake);
    await snapshot(tabs);
    const [disabled, threshold] = await Promise.all([
      read('inactive_tabs_threshold_disabled'),
      read('inactive_tabs_settings'),
    ]);
    if (disabled === true || !threshold) return;
    const tracked = (await read('all_tracked_tabs')) ?? {};
    const inactive = tabs.filter(
      (t) =>
        typeof t.id === 'number' &&
        !t.active &&
        tracked[String(t.id)] &&
        awake - tracked[String(t.id)].timeStamp > minutes(threshold) * 60000,
    );
    if (!inactive.length) return;
    const [whitelist, prefs] = await Promise.all([read('whitelisted_domains'), settings()]);
    const candidates = inactive.filter(
      (t) =>
        !(t.url && (whitelist ?? []).some((rule) => matches(t.url!, rule))) &&
        !(prefs.excludePinnedTabs && t.pinned) &&
        !(prefs.excludeAudioTabs && t.audible && !t.mutedInfo?.muted),
    );
    const ids = candidates.map((t) => t.id!);
    if (!ids.length) return;
    await archive(ids);
    let closed = 0;
    for (const id of ids) {
      try {
        await chrome.tabs.remove(id);
        closed++;
      } catch {
        await updateTracked((data) => {
          delete data[id];
        });
      }
    }
    if (closed > 0) await write('total_auto_closed_tabs_count', (await count()) + closed);
  }
  async function onCreated(tab: chrome.tabs.Tab) {
    if (typeof tab.id !== 'number') return;
    const awake = await checkpoint();
    await updateTracked((data) => {
      data[String(tab.id)] = { timeStamp: awake };
    });
  }
  async function onUpdated(id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
    if (!('url' in change || 'title' in change)) return;
    if (!validUrl(tab.url ?? '')) {
      await updateCache((data) => {
        delete data[id];
      });
      return;
    }
    await updateCache((data) => {
      const item = data[id] ?? { url: null, title: null };
      if (change.url) item.url = change.url;
      if (change.title) item.title = change.title;
      data[id] = item;
    });
  }
  const handlers: {
    [K in MessageType]: (
      body: unknown,
      sender: chrome.runtime.MessageSender,
    ) => Promise<Result<Messages[K][1]>>;
  } = {
    getWhitelist: async () => ok((await read('whitelisted_domains')) ?? []),
    saveWhitelist: async (body) => {
      const result = validateWhitelist(body);
      if (result.ok) await write('whitelisted_domains', result.data);
      return result;
    },
    getInactiveTabsSettings: async () => ok(await read('inactive_tabs_settings')),
    saveInactiveTabsSettings: async (body) => {
      const result = validateThreshold(body);
      if (result.ok) {
        await write('inactive_tabs_settings', result.data);
        await ensureAlarm();
        await updateBadge();
      }
      return result;
    },
    getInactivityDisabledState: async () =>
      ok((await read('inactive_tabs_threshold_disabled')) === true),
    saveInactivityDisabledState: async (body) => {
      if (typeof body !== 'boolean') return fail('Invalid disabled state.');
      const value = await read('inactive_tabs_settings');
      if (!value) return fail('No inactivity settings to update.');
      if (!validateThreshold(value).ok) return fail('Existing inactivity settings are invalid.');
      await write('inactive_tabs_threshold_disabled', body);
      await updateBadge();
      return ok(body);
    },
    getArchivedTabs: async () => {
      const list = await read('archived_tabs');
      return ok(Array.isArray(list) ? list : []);
    },
    restoreArchivedTab: async (body) => {
      if (!body || typeof body !== 'object') return fail('Invalid restore request.');
      const { id, url } = body as { id: string; url?: string };
      if (typeof id !== 'string') return fail('Invalid restore request.');
      if (typeof url === 'string' && !validUrl(url)) return fail('This tab cannot be reopened.');
      let targetUrl: string | null = null;
      await updateArchive((data) => {
        const item = data.find((t) => t.id === id);
        if (item) {
          targetUrl = item.url;
          return data.filter((t) => t.id !== id);
        }
        return data;
      });
      if (!targetUrl) return fail('This tab is no longer in the archive.');
      if (!validUrl(targetUrl)) return fail('This tab cannot be reopened.');
      await chrome.tabs.create({ url: targetUrl });
      return ok(null);
    },
    getArchiveOverlayVisibility: async () => {
      const position = await read('archive_overlay_position');
      return ok({
        showOverlay: (await settings()).showArchiveOverlay,
        position: validPosition(position) ? position : null,
      });
    },
    disableArchiveOverlay: async () => {
      const result = await saveSettings({ ...(await settings()), showArchiveOverlay: false });
      return result.ok ? ok(null) : result;
    },
    saveArchiveOverlayPosition: async (body) => {
      if (!validPosition(body)) return fail('Invalid overlay position.');
      await write('archive_overlay_position', body as Position);
      return ok(null);
    },
    getUserSettings: async () => ok(await settings()),
    saveUserSettings: saveSettings,
    updateTabActivity: async (_, sender) => {
      const id = sender.tab?.id;
      if (typeof id !== 'number') return fail('Missing tab id');
      const awake = await checkpoint();
      await updateTracked((data) => {
        if (data[String(id)]) data[String(id)].timeStamp = awake;
      });
      return ok(null);
    },
    getTotalAutoClosedTabsCount: async () => ok(await count()),
  };
  async function dispatch(
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<Result<unknown>> {
    try {
      const { type, body } = (message ?? {}) as { type: MessageType; body: unknown };
      if (!Object.hasOwn(handlers, type)) return fail('Unsupported message type');
      if (!allowed(type, sender)) return fail('Unauthorized sender');
      return await handlers[type](body, sender);
    } catch {
      return fail('Unexpected message handling error');
    }
  }
  let initializing: Promise<void> | null = null;
  // Preserve the original initialization coalescing and per-task error isolation.
  const initialize = () =>
    (initializing ??= (async () => {
      for (const task of [
        async () => {
          await checkpoint();
        },
        ensureAlarm,
        alignTabs,
        updateBadge,
      ]) {
        try {
          await task();
        } catch (e) {
          console.error('Tabsence initialization', e);
        }
      }
    })().finally(() => {
      initializing = null;
    }));
  let mounting: Promise<void> | null = null;
  const mountLocal = () =>
    (mounting ??= (async () => {
      for (const task of [snapshot, async () => inject('archive')]) {
        try {
          await task();
        } catch (e) {
          console.error('Tabsence mount', e);
        }
      }
    })().finally(() => {
      mounting = null;
    }));
  return {
    dispatch,
    initialize,
    mountLocal,
    inject,
    sweep,
    updateBadge,
    onCreated,
    onUpdated,
    onRemoved: async (id: number) => {
      await Promise.all([
        updateTracked((data) => {
          delete data[id];
        }).catch(console.error),
        archive([id]),
      ]);
    },
  };
}
