import css from './archive.css?inline';
import { clampPosition, validPosition } from '../core/rules';
import { getLanguage, resolveLanguage, text } from '../i18n';
import type { ArchivedTab, Language, Position, Settings } from '../shared/model';
import { send } from '../shared/protocol';
import { attachDrag } from './drag';
import { archiveIcon, hideIcon } from './icons';
type OverlayWindow = Window & { __tabsenceArchiveOverlayInitialized?: boolean };
const current = window as OverlayWindow;
const key = '__tabsenceArchiveOverlayInitialized';

export async function mountArchive(): Promise<boolean> {
  const visibility = await send('getArchiveOverlayVisibility');
  if (!visibility.ok || !visibility.data?.showOverlay) return false;
  const result = await send('getArchivedTabs');
  if (!result.ok) return false;
  let language: Language = await getLanguage(),
    records = result.data ?? [],
    query = '',
    restoring = false;
  let position: Position | null = null,
    errorTimer: ReturnType<typeof setTimeout> | null = null,
    searchTimer: ReturnType<typeof setTimeout> | null = null,
    toggleWidth = 0,
    toggleHeight = 0;
  const host = document.createElement('div');
  host.id = 'tabsence-archive-overlay';
  const root = host.attachShadow({ mode: 'closed' }),
    style = document.createElement('style');
  style.textContent = css;
  root.append(style);
  const button = (className: string) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    return node;
  };
  const toggle = button('toggle'),
    label = document.createElement('span');
  label.className = 'toggle-label';
  toggle.innerHTML = archiveIcon;
  toggle.append(label);
  const panel = document.createElement('div');
  panel.className = 'panel';
  const heading = document.createElement('div');
  heading.className = 'panel-header';
  const searchWrap = document.createElement('div');
  searchWrap.className = 'panel-search';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'search-input';
  searchWrap.append(search);
  const list = document.createElement('div');
  list.className = 'list';
  const status = document.createElement('div');
  status.className = 'status';
  const footer = document.createElement('div');
  footer.className = 'panel-footer';
  const hide = button('hide-button');
  hide.innerHTML = hideIcon;
  const hideLabel = document.createElement('span');
  hideLabel.className = 'hide-label';
  hide.append(hideLabel);
  footer.append(hide);
  panel.append(heading, searchWrap, list, status, footer);
  root.append(toggle, panel);
  const t = (k: Parameters<typeof text>[1]) => text(language, k);
  const measureToggle = () => {
    toggleWidth = toggle.offsetWidth;
    toggleHeight = toggle.offsetHeight;
  };
  const apply = (p: Position) => {
    if (!toggleWidth || !toggleHeight) measureToggle();
    position = clampPosition(p, innerWidth, innerHeight, toggleWidth, toggleHeight);
    toggle.style.left = `${position.leftPx}px`;
    toggle.style.top = `${position.topPx}px`;
    toggle.style.right = 'auto';
    toggle.style.bottom = 'auto';
    return position;
  };
  const placePanel = () => {
    if (!position) return;
    const r = toggle.getBoundingClientRect(),
      above = r.top - 16 >= panel.offsetHeight,
      right = r.left + r.width / 2 > innerWidth / 2;
    const left = right ? r.left + r.width - panel.offsetWidth : r.left,
      top = above ? r.top - 8 - panel.offsetHeight : r.top + r.height + 8;
    const p = clampPosition(
      { leftPx: left, topPx: top },
      innerWidth,
      innerHeight,
      panel.offsetWidth,
      panel.offsetHeight,
    );
    panel.style.left = `${p.leftPx}px`;
    panel.style.top = `${p.topPx}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transformOrigin = `${right ? 'right' : 'left'} ${above ? 'bottom' : 'top'}`;
  };
  const error = () => {
    status.textContent = t('restoreFailure');
    status.classList.add('visible');
    if (errorTimer !== null) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => status.classList.remove('visible'), 4000);
  };
  const restore = async (record: ArchivedTab) => {
    if (restoring) return;
    restoring = true;
    const r = await send('restoreArchivedTab', { id: record.id, url: record.url });
    restoring = false;
    if (!r.ok) error();
  };
  const render = () => {
    const q = query.trim().toLowerCase(),
      filtered = records
        .toReversed()
        .filter((r) => !q || r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = t(records.length ? 'noMatches' : 'empty');
      list.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const record of filtered) {
      const row = button('row');
      row.dataset.id = record.id;
      row.title = t('restore');
      const title = document.createElement('span');
      title.className = 'row-title';
      title.textContent = record.title || record.url;
      const url = document.createElement('span');
      url.className = 'row-url';
      url.textContent = record.url;
      row.append(title, url);
      fragment.append(row);
    }
    list.replaceChildren(fragment);
  };
  const translate = () => {
    host.lang = language;
    label.textContent = t('overlayLabel');
    toggle.title = t('overlayTitle');
    toggle.setAttribute('aria-label', t('overlayTitle'));
    heading.textContent = t('overlayTitle');
    search.placeholder = t('search');
    search.setAttribute('aria-label', t('search'));
    hideLabel.textContent = t('hide');
    hide.title = t('hideTitle');
    if (status.classList.contains('visible')) status.textContent = t('restoreFailure');
    render();
  };
  const resize = () => {
    measureToggle();
    if (position) apply(position);
    if (panel.classList.contains('open')) placePanel();
  };
  const outside = (event: Event) => {
    if (!event.composedPath().includes(host)) panel.classList.remove('open');
  };
  const fullscreen = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    host.style.display = (doc.fullscreenElement ?? doc.webkitFullscreenElement) ? 'none' : '';
    if (host.style.display) panel.classList.remove('open');
  };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (!chrome.runtime?.id) {
      detach();
      return;
    }
    if (area !== 'local') return;
    if ((changes.user_settings?.newValue as Settings | undefined)?.showArchiveOverlay === false) {
      detach();
      return;
    }
    if (validPosition(changes.archive_overlay_position?.newValue))
      apply(changes.archive_overlay_position.newValue);
    if (changes.archived_tabs) {
      records = (changes.archived_tabs.newValue ?? []) as ArchivedTab[];
      render();
    }
    if (changes.ui_language) {
      language = resolveLanguage(changes.ui_language.newValue);
      translate();
    }
  };
  const drag = attachDrag(
    toggle,
    apply,
    () => {
      panel.classList.remove('open');
      measureToggle();
    },
    (p) => {
      void send('saveArchiveOverlayPosition', p);
    },
  );
  function detach() {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (errorTimer !== null) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    toggle.removeEventListener('pointerdown', measureToggle);
    chrome.storage.onChanged.removeListener(changed);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('fullscreenchange', fullscreen);
    document.removeEventListener('webkitfullscreenchange', fullscreen);
    window.removeEventListener('resize', resize);
    drag.detach();
    host.remove();
    current[key] = false;
  }
  toggle.addEventListener('click', () => {
    if (!drag.consumeClick() && panel.classList.toggle('open')) placePanel();
  });
  toggle.addEventListener('pointerdown', measureToggle);
  list.addEventListener('click', (e) => {
    const element = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement;
    const row = element?.closest<HTMLButtonElement>('button[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    if (!id) return;
    const record = records.find((r) => r.id === id);
    if (record) void restore(record);
  });
  // send() resolves errors to a Result; either result still tears down this page's overlay.
  hide.addEventListener('click', () => {
    void send('disableArchiveOverlay').then(detach);
  });
  search.addEventListener('input', () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      query = search.value;
      render();
    }, 150);
  });
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('fullscreenchange', fullscreen);
  document.addEventListener('webkitfullscreenchange', fullscreen);
  window.addEventListener('resize', resize);
  chrome.storage.onChanged.addListener(changed);
  translate();
  document.documentElement.append(host);
  measureToggle();
  if (visibility.data.position) apply(visibility.data.position);
  fullscreen();
  return true;
}
export function startArchive() {
  if (current[key]) return;
  current[key] = true;
  void mountArchive().then((mounted) => {
    if (!mounted) current[key] = false;
  });
}
startArchive();
