import type { ArchivedTab, MatchMode, Position, Rule, Threshold, Unit } from '../shared/model';
import { fail, ok, type Result } from '../shared/protocol';
export const ranges: Record<Unit, { min: number; max: number }> = {
  minutes: { min: 1, max: 60 },
  hours: { min: 1, max: 23 },
  days: { min: 1, max: 30 },
  months: { min: 1, max: 12 },
};
export const multipliers: Record<Unit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  months: 43200,
};
export function validateThreshold(input: unknown): Result<Threshold> {
  const { value, unit } = (input ?? {}) as Threshold;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Object.hasOwn(ranges, unit))
    return fail('Invalid inactivity settings.');
  const { min, max } = ranges[unit];
  return value < min || value > max ? fail('Invalid inactivity settings.') : ok({ value, unit });
}
export const minutes = (s: Threshold) => Math.max(1, s.value * multipliers[s.unit]);
export const period = (m: number) => Math.min(30, Math.max(1, Math.floor(m / 10)));
export const badgeUnitMap: Record<Unit, string> = {
  minutes: 'm',
  hours: 'h',
  days: 'd',
  months: 'mo',
};
export function formatBadgeText(threshold: Threshold | null | undefined, disabled: boolean): string {
  if (disabled || !threshold) return 'OFF';
  return `${threshold.value}${badgeUnitMap[threshold.unit] ?? 'm'}`;
}
export const awakeDelta = (delta: number, max: number) => (delta > 0 && delta <= max ? delta : 0);
export const cropArchive = (tabs: ArchivedTab[], limit = 500) =>
  tabs.length <= limit ? tabs : tabs.toSorted((a, b) => a.closedAt - b.closedAt).slice(-limit);
export const validUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const modes: MatchMode[] = ['mode_exact', 'mode_subdomain', 'mode_wildcard'];
const stripWww = (s: string) => (s.startsWith('www.') ? s.slice(4) : s);
const trimSlashes = (s: string) => s.replace(/\/+$/, '');
export function normalizeRule(input: Rule): Rule | null {
  if (!input || !modes.includes(input.matchMode) || typeof input.domain !== 'string') return null;
  const raw = input.domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('?')[0]
    .split('#')[0];
  const slash = raw.indexOf('/');
  const host = stripWww((slash < 0 ? raw : raw.slice(0, slash)).toLowerCase());
  const path = slash < 0 ? '' : trimSlashes(raw.slice(slash));
  const wildcard = input.matchMode === 'mode_wildcard';
  if (
    !host ||
    host.includes('..') ||
    host.startsWith('.') ||
    host.endsWith('.') ||
    /\s/.test(host + (input.matchMode === 'mode_exact' ? path : '')) ||
    !host.split('.').every((s) => (wildcard ? /^[a-z0-9*-]+$/i : /^[a-z0-9-]+$/i).test(s))
  )
    return null;
  return {
    id: input.id,
    domain: host + (input.matchMode === 'mode_exact' ? path : ''),
    matchMode: input.matchMode,
  };
}
export function validateWhitelist(input: unknown): Result<Rule[]> {
  if (!Array.isArray(input)) return fail('Invalid whitelist data.');
  const result: Rule[] = [],
    seen = new Set<string>();
  for (const value of input) {
    const rule = normalizeRule(value);
    if (!rule) return fail('Please enter valid domains for every rule.');
    const key = `${rule.matchMode}:${rule.domain}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(rule);
    }
  }
  return result.length > 50 ? fail('You can save up to 50 whitelist rules.') : ok(result);
}
export function matches(url: string, value: Rule): boolean {
  const rule = normalizeRule(value);
  if (!rule || !validUrl(url)) return false;
  const target = new URL(url),
    hostname = target.hostname.toLowerCase();
  if (rule.matchMode === 'mode_exact')
    return stripWww(hostname) + trimSlashes(target.pathname) === rule.domain;
  if (rule.matchMode === 'mode_subdomain') {
    const host = stripWww(hostname);
    return host === rule.domain || host.endsWith(`.${rule.domain}`);
  }
  const expression = rule.domain.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${expression}$`, 'i').test(hostname);
}
export const validPosition = (p: unknown): p is Position =>
  !!p &&
  typeof p === 'object' &&
  Number.isFinite((p as Position).leftPx) &&
  Number.isFinite((p as Position).topPx);
export const clampPosition = (
  p: Position,
  width: number,
  height: number,
  toggleWidth: number,
  toggleHeight: number,
): Position => ({
  leftPx: Math.round(Math.min(Math.max(p.leftPx, 8), Math.max(8, width - toggleWidth - 8))),
  topPx: Math.round(Math.min(Math.max(p.topPx, 8), Math.max(8, height - toggleHeight - 8))),
});
