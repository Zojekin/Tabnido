import { vi } from 'vitest';
import type { ArchivedTab } from '../src/shared/model';
export function event() {
  const listeners = new Set<(...args: any[]) => any>();
  return {
    addListener: vi.fn((f: (...args: any[]) => any) => listeners.add(f)),
    removeListener: vi.fn((f: (...args: any[]) => any) => listeners.delete(f)),
    emit: (...args: any[]) => [...listeners].map((f) => f(...args)),
    listeners,
  };
}
export const popupSender = { id: 'test', url: 'chrome-extension://test/popup.html' };
export const contentSender = {
  id: 'test',
  url: 'https://example.com/',
  tab: { id: 1 },
} as chrome.runtime.MessageSender;
export const record = (id = 'a', closedAt = 1): ArchivedTab => ({
  id,
  url: `https://example.com/${id}`,
  title: `Title ${id}`,
  closedAt,
});
export function mockChrome(
  initial: Record<string, unknown> = {},
  tabs: Partial<chrome.tabs.Tab>[] = [],
) {
  const data: Record<string, any> = structuredClone(initial),
    changes = event(),
    calls: string[] = [];
  const api = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const result: Record<string, unknown> = {};
          for (const k of typeof keys === 'string' ? [keys] : keys)
            if (k in data) result[k] = structuredClone(data[k]);
          return result;
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          calls.push('set:' + Object.keys(values).join(','));
          const changed: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(values)) {
            changed[k] = { oldValue: structuredClone(data[k]), newValue: structuredClone(v) };
            data[k] = structuredClone(v);
          }
          changes.emit(changed, 'local');
        }),
      },
      onChanged: changes,
    },
    runtime: {
      id: 'test',
      getManifest: vi.fn(() => ({
        content_scripts: [{ js: ['content-scripts/activity.js', 'content-scripts/archive.js'] }],
      })),
      sendMessage: vi.fn(),
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
    },
    tabs: {
      query: vi.fn(async () => structuredClone(tabs)),
      create: vi.fn(async ({ url }: { url: string }) => {
        calls.push('create:' + url);
        return { id: 10, url };
      }),
      remove: vi.fn(async (id: number) => {
        calls.push('remove:' + id);
      }),
      onCreated: event(),
      onRemoved: event(),
      onUpdated: event(),
    },
    scripting: {
      executeScript: vi.fn(
        async (_injection: { target: { tabId: number }; files: string[] }) => [],
      ),
    },
    alarms: {
      get: vi.fn(async (_name: string) => undefined as chrome.alarms.Alarm | undefined),
      clear: vi.fn(async () => true),
      create: vi.fn(async (_name: string, _info: chrome.alarms.AlarmCreateInfo) => {}),
      onAlarm: event(),
    },
    action: {
      setIcon: vi.fn(async () => {}),
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setBadgeTextColor: vi.fn(async () => {}),
      setTitle: vi.fn(async () => {}),
    },
    i18n: { getUILanguage: vi.fn(() => 'en-US') },
  };
  vi.stubGlobal('chrome', api);
  return { api, data, changes, calls };
}
