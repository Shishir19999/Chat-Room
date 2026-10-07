// Simulated chat partners for the demo. Pure functions; randomness is injected.
import { botsForRoom } from './seed.js';
import { tokenize } from '../../lib/text.js';

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length) % arr.length];

const REPLIES = {
  greeting: ['Hey {user}, welcome in!', 'Hi {user}! Good to see you.', 'Hello {user}, how is your day going?', 'Hey hey, {user}!'],
  thanks: ['Anytime!', 'You are welcome, {user}.', 'Happy to help.', 'No problem at all.'],
  bye: ['See you later, {user}!', 'Take care!', 'Bye for now, talk soon.'],
  help: [
    'You can react to a message with the smiley button, reply with the arrow, and mention people with @name.',
    'Try the search icon in the header to find older messages, or paste an image straight into the message box.',
    'Open the other rooms from the sidebar, or create your own with the plus button.',
  ],
  question: ['Good question, {user}. My vote is to try it and see.', 'Hmm, I would say it depends. What are you leaning toward?', 'I have wondered the same thing. Anyone else have thoughts?', 'Honestly not sure, but I would start with the simplest option.'],
  laugh: ['Ha, that made my day.', 'Okay, that is funny.', 'I cannot stop smiling at that one.'],
  agree: ['Totally agree with you there.', 'Same here, well said.', 'That sounds like a solid plan.'],
  music: ['Great taste! Any album you would recommend to start with?', 'Adding that to my playlist right now.', 'I have that on repeat this week too.'],
  code: ['Did you check the logs yet? Usually the answer is hiding there.', 'Have you tried writing a small failing test first?', 'Nice, ship it behind a flag and watch the dashboards.'],
  design: ['Love the direction. Maybe bump the spacing a little?', 'Check the contrast on that one, it might be borderline.', 'Clean and simple, I like it.'],
  default: ['Interesting, tell me more.', 'Makes sense to me.', 'Nice one, {user}!', 'Good point.', 'I see what you mean.', 'Thanks for sharing that.', 'Cool, I am following along.'],
};

const RULES = [
  ['greeting', /\b(hi|hello|hey|hola|yo|good (morning|evening|afternoon))\b/i],
  ['thanks', /\b(thanks|thank you|thx|cheers)\b/i],
  ['bye', /\b(bye|goodbye|see you|cya|good night)\b/i],
  ['help', /\b(help|how do i|how to|what can you do)\b/i],
  ['laugh', /(\bhaha+\b|\blol\b|\blmao\b|😂|🤣)/i],
  ['music', /\b(song|album|playlist|music|band|listening)\b/i],
  ['code', /\b(bug|code|deploy|build|test|pr|merge|api|error)\b/i],
  ['design', /\b(design|color|colour|figma|mockup|font|layout)\b/i],
  ['question', /\?\s*$/],
  ['agree', /\b(agree|exactly|right|true|sounds good)\b/i],
];

export function classify(text) {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return 'default';
}

export function mentionedBots(text, room) {
  const present = botsForRoom(room);
  const names = new Set(tokenize(text).filter((t) => t.type === 'mention').map((t) => t.value.slice(1).toLowerCase()));
  return present.filter((b) => names.has(b));
}

/**
 * Plans how the bots react to a user message.
 * Returns { replies: [{ bot, text, typingMs, delayMs }], reaction: { bot, emoji, delayMs } | null }
 */
export function planBotResponse({ text, user, room, rand = Math.random }) {
  const present = botsForRoom(room);
  const mentioned = mentionedBots(text, room);
  const kind = classify(text);
  const replies = [];
  const shouldReply = mentioned.length > 0 || kind !== 'default' || rand() < 0.7;
  if (shouldReply) {
    const bot = mentioned.length ? mentioned[0] : pick(present, rand);
    replies.push({
      bot,
      text: pick(REPLIES[kind], rand).replaceAll('{user}', user),
      typingMs: 700 + Math.round(rand() * 1100),
      delayMs: 500 + Math.round(rand() * 900),
    });
    // Occasionally a second bot chimes in.
    if (kind === 'question' && rand() < 0.5) {
      const other = present.filter((b) => b !== bot);
      if (other.length) {
        replies.push({ bot: pick(other, rand), text: pick(REPLIES.agree, rand), typingMs: 800 + Math.round(rand() * 900), delayMs: 2800 + Math.round(rand() * 1200) });
      }
    }
  }
  const reaction = rand() < 0.35 ? { bot: pick(present, rand), emoji: pick(['👍', '❤️', '😂', '🎉', '👀'], rand), delayMs: 1500 + Math.round(rand() * 1500) } : null;
  return { replies, reaction };
}

// A line an idle bot may post on its own (to make other rooms feel alive).
const AMBIENT = [
  'Anyone around? Just checking the room.',
  'Quick reminder to take a short break and stretch.',
  'Fun fact of the day: honey never spoils.',
  'Does anyone have a good article to share this week?',
  'Reminder: you can reply to any message with the arrow button.',
  'Tip: type @ and a name to mention someone.',
  'Happy to help if anyone has a question.',
];
export function planAmbient({ rooms, rand = Math.random }) {
  const room = pick(rooms, rand);
  return { room, bot: pick(botsForRoom(room), rand), text: pick(AMBIENT, rand) };
}
