import type { ArchivedTab, Position, Rule, Settings, Threshold } from './model';
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: string): Result<never> => ({ ok: false, error });
export interface Messages {
  getWhitelist: [undefined, Rule[]];
  saveWhitelist: [Rule[], Rule[]];
  getInactiveTabsSettings: [undefined, Threshold | null];
  saveInactiveTabsSettings: [Threshold, Threshold];
  getInactivityDisabledState: [undefined, boolean];
  saveInactivityDisabledState: [boolean, boolean];
  getArchivedTabs: [undefined, ArchivedTab[]];
  restoreArchivedTab: [{ id: string; url: string }, null];
  getArchiveOverlayVisibility: [undefined, { showOverlay: boolean; position: Position | null }];
  disableArchiveOverlay: [undefined, null];
  saveArchiveOverlayPosition: [Position, null];
  getUserSettings: [undefined, Settings];
  saveUserSettings: [Settings, Settings];
  updateTabActivity: [undefined, null];
  getTotalAutoClosedTabsCount: [undefined, number];
}
export type MessageType = keyof Messages;
export async function send<K extends MessageType>(
  type: K,
  ...args: Messages[K][0] extends undefined ? [] : [Messages[K][0]]
): Promise<Result<Messages[K][1]>> {
  try {
    return (
      (await chrome.runtime.sendMessage({ type, body: args[0] })) ||
      fail('No response from background worker')
    );
  } catch {
    return fail('Failed to send runtime message');
  }
}
export const privileged = new Set<MessageType>([
  'saveWhitelist',
  'saveInactiveTabsSettings',
  'saveInactivityDisabledState',
  'saveUserSettings',
]);
export const contentOnly = new Set<MessageType>([
  'getArchiveOverlayVisibility',
  'disableArchiveOverlay',
  'saveArchiveOverlayPosition',
  'updateTabActivity',
]);
export function allowed(type: MessageType, sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (
    privileged.has(type) &&
    !(
      sender.id === chrome.runtime.id &&
      sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
    )
  )
    return false;
  return !(contentOnly.has(type) && typeof sender.tab?.id !== 'number');
}
