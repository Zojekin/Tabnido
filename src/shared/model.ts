export type Unit = 'minutes' | 'hours' | 'days' | 'months';
export type Threshold = { value: number; unit: Unit };
export type MatchMode = 'mode_exact' | 'mode_subdomain' | 'mode_wildcard';
export type Rule = { id: string; domain: string; matchMode: MatchMode };
export type ArchivedTab = { id: string; url: string; title: string; closedAt: number };
export type Settings = {
  excludePinnedTabs: boolean;
  excludeAudioTabs: boolean;
  showArchiveOverlay: boolean;
};
export type Position = { leftPx: number; topPx: number };
export type Language = 'zh-CN' | 'en';
export const defaults: Settings = {
  excludePinnedTabs: false,
  excludeAudioTabs: false,
  showArchiveOverlay: true,
};
export interface StoredData {
  all_tracked_tabs: Record<string, { timeStamp: number }>;
  inactive_tabs_settings: Threshold;
  inactive_tabs_threshold_disabled: boolean;
  whitelisted_domains: Rule[];
  user_settings: Settings;
  all_tabs_urls: Record<string, { url: string | null; title: string | null }>;
  archived_tabs: ArchivedTab[];
  archive_overlay_position: Position;
  total_auto_closed_tabs_count: number;
  total_awake_milliseconds: number;
  last_checkpoint_wall_clock: number;
  ui_language: Language;
}
