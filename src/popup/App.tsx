import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ranges, validateThreshold, validateWhitelist, validUrl } from '../core/rules';
import { errorText, getLanguage, resolveLanguage, text, type TextKey } from '../i18n';
import {
  defaults,
  type ArchivedTab,
  type Language,
  type MatchMode,
  type Rule,
  type Settings,
  type Threshold,
  type Unit,
} from '../shared/model';
import { send } from '../shared/protocol';
import { ErrorBoundary } from './ErrorBoundary';
import { ClockIcon, ShieldIcon, ArchiveIcon, SettingsIcon } from './NavIcons';
import { SunIcon, MoonIcon, TrashIcon, SearchIcon, PlusIcon, GlobeIcon } from './Icons';

type Context = { language: Language; error: (message: string, fallback?: TextKey) => void };
const headings = ['close', 'whitelist', 'archive', 'settings'] as const;
const navIcons = {
  close: ClockIcon,
  whitelist: ShieldIcon,
  archive: ArchiveIcon,
  settings: SettingsIcon,
};
const units: Unit[] = ['minutes', 'hours', 'days', 'months'];
const modes: Record<MatchMode, TextKey> = {
  mode_subdomain: 'subdomain',
  mode_exact: 'exact',
  mode_wildcard: 'wildcard',
};
const local = (language: Language, zh: string, en: string) => (language === 'zh-CN' ? zh : en);
function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d={up ? 'm7 14 5-5 5 5' : 'm7 10 5 5 5-5'} />
    </svg>
  );
}
function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={onChange}
      />
      <span className="switch-track" />
    </label>
  );
}
export function App() {
  const [language, setLanguage] = useState<Language>(resolveLanguage(undefined));
  const [tab, setTab] = useState<(typeof headings)[number]>('close');
  const [notice, setNotice] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    void getLanguage().then(setLanguage);
    void chrome.storage.local
      .get('ui_theme')
      .then((r) => setTheme(r.ui_theme === 'dark' ? 'dark' : 'light'));
    const changed = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && c.ui_language) setLanguage(resolveLanguage(c.ui_language.newValue));
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const ctx: Context = {
    language,
    error: (message, fallback) => setNotice(errorText(language, message, fallback)),
  };
  async function changeLanguage(next: Language) {
    try {
      await chrome.storage.local.set({ ui_language: next });
      setLanguage(next);
    } catch {
      setNotice(text(language, 'saveFailure'));
    }
  }
  async function changeTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    try {
      await chrome.storage.local.set({ ui_theme: next });
      setTheme(next);
    } catch {
      setNotice(text(language, 'saveFailure'));
    }
  }
  return (
    <ErrorBoundary language={language}>
      <div className="shell">
        <aside className="index">
          <div className="mark">
            <img src="brand/symbol.svg" alt="Tabnido" />
          </div>
          <nav aria-label="Tabnido">
            {headings.map((name) => {
              const Icon = navIcons[name];
              return (
                <button
                  type="button"
                  className="nav-item"
                  key={name}
                  aria-current={tab === name ? 'page' : undefined}
                  onClick={() => {
                    setNotice('');
                    setTab(name);
                  }}
                >
                  <Icon />
                  <span>{text(language, name === 'close' ? 'expiry' : name)}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <main className="main">
          <header className="brand-row">
            <img className="wordmark" src="brand/wordmark.svg" alt="tabnido" />
            <div className="tools">
              <label className="language">
                <span className="sr-only">{text(language, 'language')}</span>
                <select
                  aria-label={text(language, 'language')}
                  value={language}
                  onChange={(e) => void changeLanguage(e.target.value as Language)}
                >
                  <option value="zh-CN">中</option>
                  <option value="en">EN</option>
                </select>
              </label>
              <button
                className="tool"
                aria-label={text(language, theme === 'light' ? 'themeDark' : 'themeLight')}
                onClick={() => void changeTheme()}
              >
                {theme === 'dark' ? <MoonIcon size={15} /> : <SunIcon size={15} />}
              </button>
            </div>
          </header>
          {tab === 'close' ? (
            <CloseTabs {...ctx} />
          ) : tab === 'whitelist' ? (
            <Whitelist {...ctx} />
          ) : tab === 'archive' ? (
            <Archive {...ctx} />
          ) : (
            <Preferences {...ctx} />
          )}
        </main>
        {notice && (
          <div className="toast" role="alert">
            {notice}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
function Loading({
  language,
  failed,
  retry,
}: {
  language: Language;
  failed: boolean;
  retry: () => void;
}) {
  return (
    <div className="loading">
      <p role={failed ? 'alert' : 'status'}>{text(language, failed ? 'loadFailure' : 'loading')}</p>
      {failed && <button onClick={retry}>{text(language, 'retry')}</button>}
    </div>
  );
}
function CloseTabs({ language, error }: Context) {
  const t = (k: TextKey) => text(language, k);
  const [draft, setDraft] = useState<Threshold>({ value: 1, unit: 'hours' });
  const [configured, setConfigured] = useState(false),
    [paused, setPaused] = useState(false),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [revision, refresh] = useState(0),
    [busy, setBusy] = useState(false),
    [invalid, setInvalid] = useState(false);
  const queue = useRef(Promise.resolve());
  const last = useRef<Threshold>({ value: 1, unit: 'hours' });
  const seq = useRef(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    void Promise.all([
      send('getInactiveTabsSettings'),
      send('getInactivityDisabledState'),
      send('getTotalAutoClosedTabsCount'),
    ]).then(([a, b, c]) => {
      if (!active) return;
      if (!a.ok || !b.ok) setFailed(true);
      else {
        last.current = a.data ?? { value: 1, unit: 'hours' };
        setDraft(last.current);
        setConfigured(!!a.data);
        setPaused(b.data);
        if (c.ok) setCount(c.data);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [revision]);
  function apply(next: Threshold) {
    setDraft(next);
    setInvalid(false);
    if (!validateThreshold(next).ok) return;
    const id = ++seq.current;
    queue.current = queue.current.then(async () => {
      const r = await send('saveInactiveTabsSettings', next);
      if (r.ok) {
        last.current = r.data;
        setConfigured(true);
      } else {
        error(r.error);
        if (id === seq.current) {
          setDraft(last.current);
          setInvalid(false);
        }
      }
    });
  }
  async function toggle() {
    if (busy) return;
    setBusy(true);
    await queue.current;
    if (!configured) {
      const valid = validateThreshold(draft);
      if (!valid.ok) {
        setInvalid(true);
        error(valid.error);
        setBusy(false);
        return;
      }
      const initial = await send('saveInactiveTabsSettings', valid.data);
      if (!initial.ok) {
        error(initial.error);
        setBusy(false);
        return;
      }
      last.current = initial.data;
      setConfigured(true);
    }
    const r = await send('saveInactivityDisabledState', configured ? !paused : false);
    if (r.ok) setPaused(r.data);
    else error(r.error);
    setBusy(false);
  }
  const range = ranges[draft.unit];
  return (
    <section className="editor">
      {loading || failed ? (
        <Loading language={language} failed={failed} retry={() => refresh((n) => n + 1)} />
      ) : (
        <>
          <div className="time-panel">
            <div className="quantity">
              <label htmlFor="idle-threshold">{t('close')}</label>
              <div className="number-field">
                <input
                  id="idle-threshold"
                  type="number"
                  className="duration"
                  min={range.min}
                  max={range.max}
                  step="any"
                  value={Number.isNaN(draft.value) ? '' : draft.value}
                  aria-label={t('close')}
                  aria-describedby="duration-range"
                  aria-invalid={invalid || undefined}
                  onChange={(e) =>
                    apply({ ...draft, value: e.target.value === '' ? NaN : Number(e.target.value) })
                  }
                  onBlur={() => {
                    if (!validateThreshold(draft).ok) {
                      setInvalid(true);
                      error('Invalid inactivity settings.');
                      setDraft(last.current);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      setDraft(last.current);
                      setInvalid(false);
                      e.currentTarget.blur();
                    }
                  }}
                />
                <span className="number-steppers">
                  <button
                    aria-label={local(language, '增加时长', 'Increase duration')}
                    disabled={draft.value >= range.max}
                    onClick={() =>
                      apply({
                        ...draft,
                        value: Math.min(
                          range.max,
                          (Number.isFinite(draft.value) ? draft.value : range.min) + 1,
                        ),
                      })
                    }
                  >
                    <Chevron up />
                  </button>
                  <button
                    aria-label={local(language, '减少时长', 'Decrease duration')}
                    disabled={draft.value <= range.min}
                    onClick={() =>
                      apply({
                        ...draft,
                        value: Math.max(
                          range.min,
                          (Number.isFinite(draft.value) ? draft.value : range.min) - 1,
                        ),
                      })
                    }
                  >
                    <Chevron />
                  </button>
                </span>
              </div>
              <p className="range" id="duration-range">
                <strong>{t('range')}</strong>　{range.min}–{range.max} {t(draft.unit)}
              </p>
            </div>
            <div className="unit-rail" role="radiogroup" aria-label={t('range')}>
              {units.map((unit) => (
                <label className="unit" key={unit}>
                  <input
                    type="radio"
                    name="unit"
                    checked={unit === draft.unit}
                    onChange={() =>
                      apply({
                        unit,
                        value: Math.max(
                          ranges[unit].min,
                          Math.min(
                            ranges[unit].max,
                            Number.isFinite(draft.value) ? draft.value : ranges[unit].min,
                          ),
                        ),
                      })
                    }
                  />
                  <span>{t(unit)}</span>
                  <i />
                </label>
              ))}
            </div>
          </div>
          <div className="status">
            <span className="state">
              <i className="dot" data-on={configured && !paused} />
              <span>
                {local(
                  language,
                  configured
                    ? paused
                      ? '已暂停，累计关闭'
                      : '已开启，累计关闭'
                    : '尚未开启，累计关闭',
                  configured
                    ? paused
                      ? 'Paused · closed'
                      : 'Enabled · closed'
                    : 'Not enabled · closed',
                )}{' '}
                <strong className="closed-total">{count.toLocaleString(language)}</strong>
              </span>
            </span>
            <Toggle
              checked={configured && !paused}
              disabled={busy}
              label={t(configured && !paused ? 'pause' : 'resume')}
              onChange={() => void toggle()}
            />
          </div>
        </>
      )}
    </section>
  );
}
function ModeMenu({
  value,
  language,
  disabled,
  onChange,
}: {
  value: MatchMode;
  language: Language;
  disabled: boolean;
  onChange: (v: MatchMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const wrapper = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      if (!trigger.current) return;
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const rect = trigger.current.getBoundingClientRect();
      const menuWidth = 116;
      const menuHeight = 114;
      const triggerRight = rect.right / zoom;
      const triggerTop = rect.top / zoom;
      const triggerBottom = rect.bottom / zoom;
      const viewportHeight = window.innerHeight / zoom;
      const viewportWidth = window.innerWidth / zoom;

      const showAbove =
        triggerBottom + menuHeight + 8 > viewportHeight && triggerTop - menuHeight - 8 >= 0;

      setPosition({
        left: Math.round(
          Math.max(8, Math.min(triggerRight - menuWidth, viewportWidth - menuWidth - 8)),
        ),
        top: Math.round(showAbove ? triggerTop - menuHeight - 4 : triggerBottom + 4),
      });
    };
    updatePosition();
    const close = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);
  return (
    <div
      className="mode-field"
      ref={wrapper}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault();
          const items = [
            ...wrapper.current!.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]'),
          ];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            (i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length
          ]?.focus();
        }
      }}
    >
      <button
        className="mode-trigger"
        ref={trigger}
        disabled={disabled}
        aria-label={text(language, 'ruleMode')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setTimeout(
              () =>
                wrapper.current?.querySelector<HTMLButtonElement>('[role=menuitemradio]')?.focus(),
              0,
            );
          }
        }}
      >
        <span>{text(language, modes[value])}</span>
        <Chevron />
      </button>
      {open && (
        <div
          className="mode-menu"
          style={position}
          role="menu"
          aria-label={text(language, 'ruleMode')}
        >
          {(Object.entries(modes) as [MatchMode, TextKey][]).map(([mode, key]) => (
            <button
              role="menuitemradio"
              aria-checked={mode === value}
              key={mode}
              onClick={() => {
                onChange(mode);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {text(language, key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Whitelist({ language, error }: Context) {
  const t = (k: TextKey) => text(language, k);
  const [rules, setRules] = useState<Rule[] | null>(null),
    [failed, setFailed] = useState(false),
    [revision, refresh] = useState(0),
    [busy, setBusy] = useState(false),
    [invalid, setInvalid] = useState<string | null>(null);
  const saved = useRef<Rule[]>([]);
  const queue = useRef(Promise.resolve());
  const seq = useRef(0);
  const focusNew = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void send('getWhitelist').then((r) => {
      if (!active) return;
      if (r.ok) {
        saved.current = r.data;
        setRules(r.data);
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [revision]);
  function persist(next: Rule[]) {
    const blank = next.find((r) => !r.domain.trim() && saved.current.some((s) => s.id === r.id));
    if (blank) {
      setInvalid(blank.id);
      error('Please enter valid domains for every rule.');
      return;
    }
    const valid = validateWhitelist(next.filter((r) => r.domain.trim()));
    if (!valid.ok) {
      error(valid.error);
      return;
    }
    const empty = next.filter((r) => !r.domain.trim());
    setRules([...valid.data, ...empty]);
    if (!busy && JSON.stringify(valid.data) === JSON.stringify(saved.current)) return;
    const id = ++seq.current;
    setBusy(true);
    queue.current = queue.current.then(async () => {
      const r = await send('saveWhitelist', valid.data);
      if (r.ok) saved.current = r.data;
      else {
        error(r.error);
        if (id === seq.current) setRules(saved.current);
      }
      if (id === seq.current) setBusy(false);
    });
  }
  function add() {
    if (!rules) return;
    if (rules.length >= 50) {
      error('You can save up to 50 whitelist rules.');
      return;
    }
    const id = crypto.randomUUID();
    focusNew.current = id;
    setRules([...rules, { id, domain: '', matchMode: 'mode_subdomain' }]);
  }
  async function current() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !validUrl(tab.url)) {
        error('Please enter valid domains for every rule.');
        return;
      }
      const domain = new URL(tab.url).hostname.replace(/^www\./, '');
      if (rules?.some((r) => r.domain === domain && r.matchMode === 'mode_subdomain')) return;
      if ((rules?.length ?? 0) >= 50) {
        error('You can save up to 50 whitelist rules.');
        return;
      }
      persist([...(rules ?? []), { id: crypto.randomUUID(), domain, matchMode: 'mode_subdomain' }]);
    } catch {
      error('Failed to query current website.');
    }
  }
  return (
    <section className="wl-page">
      <h1>{t('whitelist')}</h1>
      <p className="description">{t('whitelistDescription')}</p>
      {rules === null || failed ? (
        <Loading language={language} failed={failed} retry={() => refresh((n) => n + 1)} />
      ) : (
        <>
          <button className="primary quick-add" disabled={busy} onClick={() => void current()}>
            <PlusIcon size={15} />
            {t('addCurrent')}
          </button>
          <div className="list-toolbar">
            <span>{t('ruleDomain')}</span>
            <button className="icon-button" aria-label={t('addRule')} onClick={add}>
              <PlusIcon size={18} />
            </button>
          </div>
          <div className="rules">
            {rules.length === 0 ? (
              <div className="empty-state">
                <ShieldIcon size={28} />
                <p>{t('noRules')}</p>
              </div>
            ) : (
              rules.map((rule) => (
                <div className="rule" key={rule.id}>
                  <div className="domain-field">
                    <input
                      aria-label={t('ruleDomain')}
                      title={rule.domain}
                      aria-invalid={invalid === rule.id || undefined}
                      ref={(el) => {
                        if (el && focusNew.current === rule.id) {
                          focusNew.current = null;
                          el.focus();
                        }
                      }}
                      value={rule.domain}
                      placeholder={t('subdomainExample')}
                      onChange={(e) => {
                        setInvalid(null);
                        setRules(
                          rules.map((r) =>
                            r.id === rule.id ? { ...r, domain: e.target.value } : r,
                          ),
                        );
                      }}
                      onBlur={() => {
                        if (!rule.domain.trim()) {
                          if (saved.current.some((r) => r.id === rule.id)) {
                            setInvalid(rule.id);
                            error('Please enter valid domains for every rule.');
                          }
                          return;
                        }
                        const check = validateWhitelist([rule]);
                        if (!check.ok) {
                          setInvalid(rule.id);
                          error(check.error);
                          return;
                        }
                        persist(rules);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          const prior = saved.current.find((r) => r.id === rule.id);
                          setRules(
                            rules.flatMap((r) => (r.id === rule.id ? (prior ? [prior] : []) : [r])),
                          );
                          setInvalid(null);
                          e.preventDefault();
                        }
                      }}
                    />
                  </div>
                  <ModeMenu
                    value={rule.matchMode}
                    language={language}
                    disabled={busy}
                    onChange={(mode) => {
                      const next = rules.map((r) =>
                        r.id === rule.id ? { ...r, matchMode: mode } : r,
                      );
                      const valid = validateWhitelist(next.filter((r) => r.domain.trim()));
                      if (!valid.ok) {
                        error(valid.error);
                        return;
                      }
                      persist(next);
                    }}
                  />
                  <button
                    className="delete icon-button"
                    disabled={busy}
                    aria-label={t('deleteRule')}
                    onClick={() => {
                      setInvalid(null);
                      persist(rules.filter((r) => r.id !== rule.id));
                    }}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
export const PAGE_SIZE = 30;
function Archive({ language, error }: Context) {
  const t = (k: TextKey) => text(language, k);
  const [records, setRecords] = useState<ArchivedTab[] | null>(null),
    [query, setQuery] = useState(''),
    [visibleCount, setVisibleCount] = useState(PAGE_SIZE),
    [failed, setFailed] = useState(false),
    [revision, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void send('getArchivedTabs').then((r) => {
      if (!active) return;
      if (r.ok) setRecords(r.data);
      else setFailed(true);
    });
    const changed = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && c.archived_tabs)
        setRecords((c.archived_tabs.newValue ?? []) as ArchivedTab[]);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [revision]);
  useEffect(() => setVisibleCount(PAGE_SIZE), [query, records]);
  const q = query.trim().toLowerCase();
  const filtered = records
    ?.toSorted((a, b) => b.closedAt - a.closedAt)
    .filter((r) => !q || r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
  return (
    <section className="ar-page">
      <div className="ar-heading">
        <h1>{t('archive')}</h1>
        <span>{local(language, '最多 500 条', 'Up to 500 tabs')}</span>
      </div>
      {records === null || failed ? (
        <Loading language={language} failed={failed} retry={() => refresh((n) => n + 1)} />
      ) : (
        <>
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              className="search"
              type="search"
              placeholder={t('search')}
              aria-label={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              ref={(el) => {
                if (el) el.onchange = (e) => setQuery((e.target as HTMLInputElement).value);
              }}
            />
          </div>
          <div className="archive-meta">
            <span>
              {filtered?.length} {local(language, '条记录', 'records')}
            </span>
            <span>{local(language, '最近关闭', 'Recently closed')}</span>
          </div>
          <div
            className="archive-list"
            onScroll={(e) => {
              const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
              if (scrollTop + clientHeight >= scrollHeight - 40)
                setVisibleCount((n) => n + PAGE_SIZE);
            }}
          >
            {filtered?.length ? (
              <>
                {filtered.slice(0, visibleCount).map((record) => (
                  <ArchiveRow key={record.id} record={record} language={language} error={error} />
                ))}
                {visibleCount < filtered.length && <p className="loading">{t('loading')}</p>}
              </>
            ) : (
              <div className="empty-state">
                <ArchiveIcon size={28} />
                <p>{t(records.length ? 'noMatches' : 'empty')}</p>
                {query && (
                  <button onClick={() => setQuery('')}>
                    {local(language, '清除搜索', 'Clear search')}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function ArchiveRow({ record, language, error }: Context & { record: ArchivedTab }) {
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [faviconError, setFaviconError] = useState(false);
  const guard = useRef(false);
  async function restore() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const r = await send('restoreArchivedTab', { id: record.id, url: record.url });
      if (!r.ok) {
        setFailed(true);
        error(r.error, 'restoreFailure');
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  let favicon = '';
  try {
    favicon = chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(record.url)}&size=32`);
  } catch {}
  let url = record.url;
  try {
    const parsed = new URL(url);
    url = parsed.host + parsed.pathname + parsed.search;
  } catch {}
  return (
    <article className="archive-row">
      <div className="archive-record">
        <div className="record-heading">
          {favicon && !faviconError ? (
            <img
              className="favicon"
              src={favicon}
              alt=""
              loading="lazy"
              onError={() => setFaviconError(true)}
            />
          ) : (
            <GlobeIcon className="favicon" size={16} />
          )}
          <span className="row-title" title={record.title}>
            {record.title || record.url}
          </span>
        </div>
        <span className="row-url" title={record.url}>
          {url}
        </span>
        <time dateTime={new Date(record.closedAt).toISOString()}>
          {new Date(record.closedAt).toLocaleString(language, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
      <button
        disabled={busy}
        onClick={() => void restore()}
        aria-label={text(language, busy ? 'restoring' : 'restoreButton')}
      >
        {text(language, busy ? 'restoring' : 'restoreButton')}
      </button>
      {failed && (
        <p className="row-error" role="alert">
          {text(language, 'restoreFailure')}
        </p>
      )}
    </article>
  );
}
function Preferences({ language, error }: Context) {
  const t = (k: TextKey) => text(language, k);
  const [settings, setSettings] = useState<Settings | null>(null),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, refresh] = useState(0);
  const guard = useRef(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void send('getUserSettings').then((r) => {
      if (!active) return;
      if (r.ok) setSettings(r.data);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [revision]);
  async function change(key: keyof Settings) {
    if (!settings || guard.current) return;
    guard.current = true;
    const prior = settings;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setBusy(true);
    try {
      const r = await send('saveUserSettings', next);
      if (r.ok) setSettings(r.data);
      else {
        setSettings(prior);
        error(r.error);
      }
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  function row(key: keyof Settings, title: TextKey, help: TextKey) {
    return (
      <div className="prefs-row">
        <div className="prefs-copy">
          <span className="prefs-name" id={key + '-name'}>
            {t(title)}
          </span>
          <span className="prefs-help" id={key + '-help'}>
            {t(help)}
          </span>
        </div>
        <Toggle
          checked={(settings ?? defaults)[key]}
          disabled={busy}
          label={t(title)}
          onChange={() => void change(key)}
        />
      </div>
    );
  }
  return (
    <section className="prefs-page">
      <h1>{t('settings')}</h1>
      {!settings || failed ? (
        <Loading language={language} failed={failed} retry={() => refresh((n) => n + 1)} />
      ) : (
        <>
          <h2>{local(language, '标签保护', 'Tab protection')}</h2>
          {row('excludePinnedTabs', 'pinned', 'pinnedHelp')}
          {row('excludeAudioTabs', 'audio', 'audioHelp')}
          <h2 className="prefs-second">{local(language, '归档入口', 'Archive access')}</h2>
          {row('showArchiveOverlay', 'overlay', 'overlayHelp')}
        </>
      )}
    </section>
  );
}
