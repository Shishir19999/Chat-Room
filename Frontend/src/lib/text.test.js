import { describe, it, expect } from 'vitest';
import { tokenize, mentionsUser, splitHighlight, dayLabel, decorateMessages, avatarColor, initials, relativeShort } from './text.js';
import { validateUsername, validateRoomName, validateMessage, cleanRoom } from './limits.js';
import { fitDimensions } from './image.js';

describe('tokenize', () => {
  it('finds links and mentions and trims trailing punctuation', () => {
    expect(tokenize('hi @ava, see https://example.com/a?b=1.')).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', value: '@ava' },
      { type: 'text', value: ', see ' },
      { type: 'link', value: 'https://example.com/a?b=1' },
      { type: 'text', value: '.' },
    ]);
  });
  it('does not treat e-mail addresses or other schemes as links/mentions', () => {
    expect(tokenize('you@example.com javascript:alert(1)')).toEqual([{ type: 'text', value: 'you@example.com javascript:alert(1)' }]);
  });
  it('detects mentions of a user, case-insensitively', () => {
    expect(mentionsUser('hey @Demo_User!', 'demo_user')).toBe(true);
    expect(mentionsUser('hey demo_user', 'demo_user')).toBe(false);
  });
});

describe('splitHighlight', () => {
  it('splits around matches', () => {
    expect(splitHighlight('Hello hello', 'LL')).toEqual([
      { value: 'He', match: false }, { value: 'll', match: true }, { value: 'o he', match: false }, { value: 'll', match: true }, { value: 'o', match: false },
    ]);
    expect(splitHighlight('abc', '')).toEqual([{ value: 'abc', match: false }]);
  });
});

describe('dates and grouping', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);
  it('labels days', () => {
    expect(dayLabel(new Date(2026, 5, 15, 1).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 5, 14, 23).toISOString(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 5, 10).toISOString(), now)).toMatch(/June/);
  });
  it('marks day separators and grouped runs', () => {
    const t = (d, h, m) => new Date(2026, 5, d, h, m).toISOString();
    const rows = decorateMessages([
      { user: 'a', createdAt: t(1, 9, 0) },
      { user: 'a', createdAt: t(1, 9, 1) },
      { user: 'b', createdAt: t(1, 9, 2) },
      { user: 'b', createdAt: t(1, 9, 3), replyTo: { _id: 'x' } },
      { user: 'b', createdAt: t(2, 9, 3) },
    ]);
    expect(rows.map((r) => [r.newDay, r.grouped])).toEqual([[true, false], [false, true], [false, false], [false, false], [true, false]]);
  });
  it('formats short relative times', () => {
    const n = Date.now();
    expect(relativeShort(new Date(n - 5000).toISOString(), n)).toBe('now');
    expect(relativeShort(new Date(n - 5 * 60000).toISOString(), n)).toBe('5m');
    expect(relativeShort(new Date(n - 3 * 3600000).toISOString(), n)).toBe('3h');
  });
});

describe('avatars and validation', () => {
  it('is stable per name', () => {
    expect(avatarColor('Ava')).toBe(avatarColor('ava'));
    expect(initials('demo_user')).toBe('DE');
  });
  it('validates usernames, rooms and messages', () => {
    expect(validateUsername('')).toMatch(/enter/);
    expect(validateUsername('a')).toMatch(/at least/);
    expect(validateUsername('has space')).toMatch(/no spaces/);
    expect(validateUsername('demo_user')).toBe('');
    expect(validateRoomName('Bad Room')).toMatch(/lowercase/);
    expect(validateRoomName('ok-room')).toBe('');
    expect(validateMessage('', false)).toMatch(/first/);
    expect(validateMessage('', true)).toBe('');
    expect(validateMessage('x'.repeat(501))).toMatch(/500/);
    expect(cleanRoom('  Dev Room! ')).toBe('devroom');
    expect(cleanRoom('')).toBe('general');
  });
  it('fits image dimensions', () => {
    expect(fitDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitDimensions(400, 300, 1000)).toEqual({ width: 400, height: 300 });
  });
});
