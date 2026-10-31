// Fallback environment mock for previewing outside of an installed Chrome extension
if (typeof window !== 'undefined' && (!window.chrome || !window.chrome.runtime?.id)) {
  const store: Record<string, any> = {
    ui_language: 'zh-CN',
    ui_theme: 'light',
    inactive_tabs_settings: { value: 1, unit: 'hours' },
    inactive_tabs_threshold_disabled: false,
    total_auto_closed_tabs_count: 128,
    whitelisted_domains: [
      { id: '1', domain: 'notion.so', matchMode: 'mode_subdomain' },
      { id: '2', domain: 'mail.google.com', matchMode: 'mode_exact' },
      { id: '3', domain: '*.google.com', matchMode: 'mode_wildcard' },
    ],
    user_settings: { excludePinnedTabs: true, excludeAudioTabs: true, showArchiveOverlay: true },
    archived_tabs: [
      { id: '1', title: 'React 官方文档 · 组件生命周期与交互', url: 'https://react.dev/learn', closedAt: Date.now() - 300000 },
      { id: '2', title: 'Figma 界面设计系统规范', url: 'https://figma.com/design', closedAt: Date.now() - 900000 },
      { id: '3', title: 'GitHub - Tabnido 扩展仓库', url: 'https://github.com', closedAt: Date.now() - 1800000 },
    ],
  };

  const listeners = new Set<(changes: any, area: string) => void>();

  (window as any).chrome = {
    i18n: { getUILanguage: () => 'zh-CN' },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(store);
          const res: any = {};
          for (const k of list) res[k] = store[k];
          return res;
        },
        set: async (obj: any) => {
          const changes: any = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: store[k], newValue: v };
            store[k] = v;
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
      },
      onChanged: {
        addListener: (fn: any) => listeners.add(fn),
        removeListener: (fn: any) => listeners.delete(fn),
      },
    },
    runtime: {
      sendMessage: async ({ type, body }: any) => {
        try {
          if (typeof (window.parent as any)?.syncFromChild === 'function') {
            (window.parent as any).syncFromChild(type, body);
          }
        } catch {}

        if (type === 'getInactiveTabsSettings') return { ok: true, data: store.inactive_tabs_settings };
        if (type === 'saveInactiveTabsSettings') {
          store.inactive_tabs_settings = body;
          return { ok: true, data: body };
        }
        if (type === 'getInactivityDisabledState') return { ok: true, data: store.inactive_tabs_threshold_disabled };
        if (type === 'saveInactivityDisabledState') {
          store.inactive_tabs_threshold_disabled = body;
          return { ok: true, data: body };
        }
        if (type === 'getTotalAutoClosedTabsCount') return { ok: true, data: store.total_auto_closed_tabs_count };
        if (type === 'getWhitelist') return { ok: true, data: store.whitelisted_domains };
        if (type === 'saveWhitelist') {
          store.whitelisted_domains = body;
          return { ok: true, data: body };
        }
        if (type === 'getArchivedTabs') return { ok: true, data: store.archived_tabs };
        if (type === 'getUserSettings') return { ok: true, data: store.user_settings };
        if (type === 'saveUserSettings') {
          store.user_settings = body;
          return { ok: true, data: body };
        }
        if (type === 'restoreArchivedTab') {
          store.archived_tabs = store.archived_tabs.filter((t: any) => t.id !== body.id);
          return { ok: true, data: null };
        }
        return { ok: true, data: null };
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com' }],
      create: async () => {},
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
  };
}
