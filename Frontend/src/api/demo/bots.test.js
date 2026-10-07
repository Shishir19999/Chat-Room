import { describe, it, expect } from 'vitest';
import { classify, mentionedBots, planBotResponse, planAmbient } from './bots.js';
import { botsForRoom } from './seed.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('bots', () => {
  it('classifies messages', () => {
    expect(classify('Hello everyone')).toBe('greeting');
    expect(classify('thanks a lot')).toBe('thanks');
    expect(classify('what time is it?')).toBe('question');
    expect(classify('the build is red')).toBe('code');
    expect(classify('banana')).toBe('default');
  });

  it('finds mentioned bots that are in the room only', () => {
    expect(mentionedBots('hey @ben and @ava', 'dev')).toEqual(['ben']);
    expect(mentionedBots('no mention', 'dev')).toEqual([]);
  });

  it('always answers a mention, with that bot', () => {
    const plan = planBotResponse({ text: 'ping @dmitri', user: 'sam', room: 'dev', rand: seq(0.99) });
    expect(plan.replies[0].bot).toBe('dmitri');
    expect(plan.replies[0].text.length).toBeGreaterThan(0);
  });

  it('substitutes the user name and uses bots from the room', () => {
    const plan = planBotResponse({ text: 'hello', user: 'sam', room: 'music', rand: seq(0, 0.5) });
    expect(botsForRoom('music')).toContain(plan.replies[0].bot);
    expect(plan.replies[0].text).not.toContain('{user}');
    expect(plan.replies[0].typingMs).toBeGreaterThan(0);
  });

  it('can stay silent on small talk', () => {
    const plan = planBotResponse({ text: 'banana', user: 'sam', room: 'general', rand: seq(0.95) });
    expect(plan.replies).toEqual([]);
  });

  it('plans ambient chatter for an existing room', () => {
    const a = planAmbient({ rooms: ['dev', 'music'], rand: seq(0.6) });
    expect(['dev', 'music']).toContain(a.room);
    expect(botsForRoom(a.room)).toContain(a.bot);
  });
});
