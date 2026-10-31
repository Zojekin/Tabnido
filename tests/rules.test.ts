import { describe, expect, it } from 'vitest';
import {
  awakeDelta,
  clampPosition,
  cropArchive,
  formatBadgeText,
  matches,
  minutes,
  normalizeRule,
  period,
  validPosition,
  validateThreshold,
  validateWhitelist,
} from '../src/core/rules';
import type { MatchMode, Rule, Unit } from '../src/shared/model';
import { record } from './chrome';
const rule = (domain: string, matchMode: MatchMode = 'mode_exact'): Rule => ({
  id: domain,
  domain,
  matchMode,
});
describe('T02–T03 time rules', () => {
  it.each([
    ['minutes', 1, 60],
    ['hours', 1, 23],
    ['days', 1, 30],
    ['months', 1, 12],
  ] as const)('%s boundaries and decimals', (unit, min, max) => {
    for (const value of [min, max, min + 0.5])
      expect(validateThreshold({ value, unit }).ok).toBe(true);
    for (const value of [min - 0.01, max + 0.01, NaN, Infinity, -Infinity])
      expect(validateThreshold({ value, unit }).ok).toBe(false);
  });
  it('rejects unknown units and nonnumbers', () => {
    for (const unit of ['toString', 'weeks', undefined])
      expect(validateThreshold({ value: 1, unit }).ok).toBe(false);
    expect(validateThreshold({ value: '1', unit: 'hours' }).ok).toBe(false);
  });
  it('uses thirty-day months and clamped floor intervals', () => {
    expect(minutes({ value: 1, unit: 'months' })).toBe(43200);
    expect(minutes({ value: 1, unit: 'minutes' })).toBe(1);
    expect(minutes({ value: 60, unit: 'minutes' })).toBe(60);
    expect([1, 9, 15, 59, 60, 300, 400].map(period)).toEqual([1, 1, 1, 5, 6, 30, 30]);
  });
  it('formats badge texts without unit collision', () => {
    expect(formatBadgeText({ value: 1, unit: 'minutes' }, false)).toBe('1m');
    expect(formatBadgeText({ value: 60, unit: 'minutes' }, false)).toBe('60m');
    expect(formatBadgeText({ value: 2, unit: 'hours' }, false)).toBe('2h');
    expect(formatBadgeText({ value: 7, unit: 'days' }, false)).toBe('7d');
    expect(formatBadgeText({ value: 1, unit: 'months' }, false)).toBe('1mo');
    expect(formatBadgeText({ value: 15, unit: 'minutes' }, true)).toBe('OFF');
    expect(formatBadgeText(null, false)).toBe('OFF');
  });
  it('accepts the exact awake boundary, drops negative, zero and excess gaps', () => {
    expect(awakeDelta(96000, 96000)).toBe(96000);
    for (const value of [-1, 0, 96001]) expect(awakeDelta(value, 96000)).toBe(0);
  });
});
describe('T06–T07 whitelist', () => {
  it('Exact ignores protocol, host case, www, port, query, hash and trailing slash', () => {
    const r = rule('HTTPS://WWW.Example.COM/Path///?ignored#fragment');
    expect(normalizeRule(r)?.domain).toBe('example.com/Path');
    expect(matches('http://www.EXAMPLE.com:8080/Path/?x=1#y', r)).toBe(true);
    expect(matches('https://example.com/path', r)).toBe(false);
    expect(matches('https://sub.example.com/Path', r)).toBe(false);
  });
  it('protects base domain and its subdomains', () => {
    const r = rule('example.com', 'mode_subdomain');
    for (const u of ['https://example.com/a', 'http://x.example.com'])
      expect(matches(u, r)).toBe(true);
    expect(matches('https://notexample.com', r)).toBe(false);
  });
  it('anchors wildcards to full hostname without removing www from the target', () => {
    const r = rule('*.example.com', 'mode_wildcard');
    expect(matches('https://www.example.com', r)).toBe(true);
    expect(matches('https://example.com', r)).toBe(false);
    expect(matches('https://x.example.com.evil.test', r)).toBe(false);
  });
  it.each(['example.com:8080', 'localhost:80', 'x..com', '.com', 'x.com.', 'x .com', '*.com'])(
    'rejects invalid Exact %s',
    (value) => expect(validateWhitelist([rule(value)]).ok).toBe(false),
  );
  it('deduplicates before the capacity check, preserves path case and mode', () => {
    expect(validateWhitelist(Array.from({ length: 51 }, () => rule('example.com')))).toEqual({
      ok: true,
      data: [rule('example.com')],
    });
    const distinct = Array.from({ length: 51 }, (_, i) => rule(`s${i}.com`));
    expect(validateWhitelist(distinct).ok).toBe(false);
    expect(validateWhitelist(distinct.slice(0, 50)).ok).toBe(true);
    const result = validateWhitelist([
      rule('example.com/A'),
      rule('example.com/a'),
      rule('example.com/A', 'mode_subdomain'),
    ]);
    expect(result.ok && result.data.length).toBe(3);
  });
  it('rejects the whole batch when one rule is invalid', () =>
    expect(validateWhitelist([rule('ok.com'), rule('bad:80')]).ok).toBe(false));
});
describe('T11 and T15 ordering and position', () => {
  it.each([499, 500])('keeps original %i order', (size) => {
    const values = Array.from({ length: size }, (_, i) => record(String(i), size - i));
    expect(cropArchive(values)).toBe(values);
  });
  it('501 records retain newest 500 using nonmutating stable sort', () => {
    const values = Array.from({ length: 501 }, (_, i) => record(String(i), 501 - i));
    const before = [...values];
    const result = cropArchive(values);
    expect(result).toHaveLength(500);
    expect(result[0].closedAt).toBe(2);
    expect(result.at(-1)?.closedAt).toBe(501);
    expect(values).toEqual(before);
  });
  it('backend finite validation accepts negative coordinates; UI clamps to 8 and rounds', () => {
    expect(validPosition({ leftPx: -1.2, topPx: -4 })).toBe(true);
    expect(validPosition({ leftPx: Infinity, topPx: 1 })).toBe(false);
    expect(clampPosition({ leftPx: -1, topPx: 200.4 }, 100, 100, 20, 20)).toEqual({
      leftPx: 8,
      topPx: 72,
    });
  });
});
