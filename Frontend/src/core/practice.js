import { OP } from './constants.js';
import { newId } from './ops.js';

// Optional "Practice bot" for a lone visitor: a local-only helper that answers, reacts and shows typing so every
// feature can be tried in an empty room. Nothing it does is stored or sent to anyone.
const BOTS = [
  { uid: 'b0b0b0b0b0b0b0b1', name: 'Practice-bot', color: 200, status: 'Local helper, not a real person' },
];

const TIPS = [
  'Try **bold**, _italic_, `code` and a link like https://example.com.',
  'Hover (or long-press) a message for reactions, reply, edit and pin.',
  'Press the Up arrow in an empty box to edit your last message.',
  'Use @Practice-bot to mention me. Mentions are highlighted.',
  'Press Ctrl+K to jump between channels and people.',
];
const JOKES = ['Why do programmers prefer dark mode? Because light attracts bugs.', 'There are 10 kinds of people: those who understand binary and those who do not.'];

export function createPractice(engine) {
  const bot = BOTS[0];
  let active = false;
  let off = null;
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  const make = (c, t, d) => ({ id: newId(16), w: engine.ws, c, t, a: bot.uid, lc: engine.clock.tick(), ts: Date.now(), d });
  const say = (c, text, extra = {}) => engine.injectLocal(make(c, OP.MSG, { text, n: bot.name, col: bot.color, ...extra }));

  function reply(c, userOp) {
    const text = String(userOp.d.text || '').toLowerCase();
    engine.injectTyping(bot.uid, c, true);
    later(900 + Math.random() * 600, () => {
      engine.injectTyping(bot.uid, c, false);
      engine.injectLocal(make(c, OP.READ, { upto: userOp.lc }));
      if (/\bhelp\b|\btips?\b/.test(text)) say(c, TIPS.map((t) => `- ${t}`).join('\n'));
      else if (/\bjoke\b/.test(text)) say(c, JOKES[Math.floor(Math.random() * JOKES.length)], { reply: userOp.id });
      else if (/\btime\b/.test(text)) say(c, `It is ${new Date().toLocaleTimeString()} on your device.`, { reply: userOp.id });
      else if (text.includes('?')) say(c, 'Good question. I am only a practice bot, but real people can answer once they join this room.', { reply: userOp.id });
      else say(c, `You said: "${String(userOp.d.text || 'something').slice(0, 80)}". Type **help** for tips.`, { reply: userOp.id });
      if (userOp.d.text) engine.injectLocal(make(c, OP.REACT, { x: userOp.id, e: '👍', on: true }));
    });
  }

  return {
    get active() { return active; },
    start(channel = 'general') {
      if (active) return;
      active = true;
      engine.setPractice(true);
      engine.injectPresence(bot.uid, { name: bot.name, color: bot.color, status: bot.status, presence: 'online' }, true);
      off = engine.on('sent', (op) => { if (active && !op.c.startsWith('dm:')) reply(op.c, op); });
      later(500, () => say(channel, `Hi, I am a local practice bot. Nobody else is here yet, so ask me for **help** and try the features. ${TIPS[0]}`));
    },
    stop() {
      if (!active) return;
      active = false;
      off?.();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      engine.injectPresence(bot.uid, null, false);
      engine.setPractice(false);
    },
  };
}
