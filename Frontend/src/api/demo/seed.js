// Sample data for the in-browser demo, computed relative to "now".
import { hashString } from '../../lib/text.js';

export const BOTS = {
  ava: { name: 'ava', style: 'friendly' },
  ben: { name: 'ben', style: 'practical' },
  chloe: { name: 'chloe', style: 'creative' },
  dmitri: { name: 'dmitri', style: 'techie' },
  ella: { name: 'ella', style: 'cheerful' },
  felix: { name: 'felix', style: 'laid-back' },
};

export const ROOM_BOTS = {
  general: ['ava', 'ben', 'chloe'],
  dev: ['ben', 'dmitri', 'ella'],
  design: ['chloe', 'ella', 'ava'],
  random: ['ava', 'felix', 'dmitri'],
  music: ['felix', 'chloe', 'ella'],
};
export const DEFAULT_BOTS = ['ava', 'ben'];
export const botsForRoom = (room) => ROOM_BOTS[room] || DEFAULT_BOTS;

export const SEED_ROOMS = [
  { name: 'general', description: 'Announcements and everyday conversation' },
  { name: 'dev', description: 'Code, builds and deploys' },
  { name: 'design', description: 'Mockups, colors and critique' },
  { name: 'random', description: 'Off-topic fun' },
  { name: 'music', description: 'What are you listening to?' },
];

const POOLS = {
  general: [
    'Good morning everyone, coffee is on.',
    'Reminder: the weekly sync starts at 10:30 in the main room.',
    'Welcome to the new folks, glad to have you here!',
    'Has anyone seen the latest release notes?',
    'The release notes are pinned on the wiki now.',
    'Lunch plans today? I am thinking about the noodle place.',
    'Count me in for noodles.',
    'Thanks for covering the on-call shift yesterday.',
    'Happy Friday, team!',
    'Quick poll: should we move standup 15 minutes later?',
    'I would prefer later, my train is delayed on Mondays.',
    'Later works for me too.',
    'The new office plants are doing great, by the way.',
    'Who is organizing the team offsite this year?',
    'I can take the lead on the offsite, will share a draft soon.',
    'Please remember to update your profile photo before the all-hands.',
    'Does anyone have a spare charger?',
    'Top drawer by the printer, there are a few there.',
    'Thanks, found one!',
    'Reminder to submit your timesheets by end of day.',
    'Great job on the launch everyone, really proud of this team.',
    'Heads up: the elevator is out of service until noon.',
    'Taking the stairs then, good for cardio.',
    'Anyone up for a walking meeting later?',
    'Sure, ping me at 3.',
    'Bring an umbrella, rain is coming in the afternoon.',
    'I made a shared playlist for the office, link is in #music.',
    'Standup notes are in the shared doc.',
    'Can someone review my vacation request? Thanks!',
    'Approved, enjoy the time off.',
  ],
  dev: [
    'The build on main is green again.',
    'Opened a PR for the settings refactor, reviews welcome.',
    'Can someone look at the flaky search test?',
    'I think it is a race condition in the debounce helper.',
    'Merged. Deploying to staging now.',
    'Staging looks good, promoting to production in ten minutes.',
    'Latency on the messages endpoint dropped by 30% after the index change.',
    'Rolling back the last deploy, the error rate spiked.',
    'Added logging around the socket reconnect logic, check the dashboard.',
    'Code review done, left a few small nits.',
    'Bumped dependencies, please pull before pushing.',
    'Does anyone know why the cache invalidation is so slow?',
    'It rebuilds the whole tree, I have a fix in progress.',
    'TIL: structuredClone is much faster than a JSON round trip for big objects.',
    'We should add a type-check step to CI.',
    'Agreed, I will draft the workflow file.',
    'Postmortem doc is ready, please add your notes.',
    'The linter now runs on staged files only.',
    'Pair on the pagination bug tomorrow morning?',
    'Works for me, 9:30?',
    'The cursor-based pagination is much smoother than offsets.',
    'Who owns the notification service these days?',
    'That would be me, what do you need?',
    'Reminder: feature freeze is on Thursday.',
    'Docs for the new API are live.',
  ],
  design: [
    'Updated the onboarding mockups in the design file.',
    'Do we want rounded or sharp corners on the cards?',
    'Rounded feels friendlier, but keep the radius consistent.',
    'The contrast on the secondary button fails accessibility checks.',
    'Good catch, I will darken the text color.',
    'New icon set is ready for review.',
    'Can we align everything to an 8px grid?',
    'Dark mode palette draft is attached, feedback please.',
    'User testing showed confusion around the share dialog.',
    'Love the new typography, nicely done.',
    'The empty states need illustrations, any volunteers?',
    'I can sketch a few options this afternoon.',
    'Handoff spec for the profile page is complete.',
    'Let us simplify the sign-up flow to two steps.',
    'The spacing scale looks great on mobile.',
    'Could we try a softer shadow on modals?',
    'Moodboard for the spring campaign is in the folder.',
    'Remember to check focus states on all interactive elements.',
  ],
  random: [
    'Coffee or tea?',
    'Tea, always. Coffee makes me jittery.',
    'Just watched a great documentary about deep sea creatures.',
    'Anyone tried the new bakery downtown?',
    'Hot take: tabs are better than spaces.',
    'Not touching that one.',
    'Weekend hike was amazing, the view from the top was unreal.',
    'Book recommendations, anyone?',
    'Currently reading a great sci-fi novel about a generation ship.',
    'It is raining again, classic.',
    'Fun fact: octopuses have three hearts.',
    'Who is watching the match tonight?',
    'Look at this cat that decided my keyboard is a bed.',
    'Best board game for four players? Go.',
    'Cascadia is a solid pick, quick to learn.',
    'I baked bread for the first time, it was a brick.',
    'Practice makes perfect, try again this weekend.',
    'Anyone want to start a lunch-time chess club?',
  ],
  music: [
    'Currently listening to an album of ambient piano on repeat.',
    'Any good playlists for coding?',
    'Lo-fi beats are my focus music.',
    'Saw them live last night, incredible show.',
    'Vinyl or streaming?',
    'Vinyl for the ritual, streaming for convenience.',
    'That album is a masterpiece, the production is so clean.',
    'Anyone here play an instrument?',
    'Guitar, badly, but with enthusiasm.',
    'Sharing my weekend mix, lots of synthwave.',
    'The bassline on that track is unreal.',
    'Concert tickets go on sale tomorrow at ten.',
    'Jazz night at the cafe on Thursday, anyone interested?',
    'Count me in for jazz night.',
  ],
};

const SEED_COUNTS = { general: 70, dev: 40, design: 24, random: 28, music: 18 };
const SEED_USERS = {
  general: ['ava', 'ben', 'chloe', 'demo_user'],
  dev: ['ben', 'dmitri', 'ella'],
  design: ['chloe', 'ella', 'ava'],
  random: ['ava', 'felix', 'dmitri'],
  music: ['felix', 'chloe', 'ella'],
};

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const makeId = (ts, seq) => `m${ts.toString(36).padStart(9, '0')}${seq.toString(36).padStart(4, '0')}`;

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀'];

// Returns { rooms, messages, seq }. Messages are sorted oldest to newest.
export function buildSeed(now = Date.now()) {
  let seq = 0;
  const messages = [];
  const DAY = 86400000;
  for (const [room, count] of Object.entries(SEED_COUNTS)) {
    const rand = prng(hashString(`seed-${room}`));
    const pool = POOLS[room];
    const users = SEED_USERS[room];
    // Spread timestamps over ~6 days; the latest few land within the last hours.
    const span = room === 'general' ? 6 * DAY : 4 * DAY;
    const times = Array.from({ length: count }, (_, i) => {
      const progress = (i + 1) / count;
      const lateBias = progress ** 2.2;
      return now - Math.round((1 - lateBias) * span) - Math.round(rand() * 20 * 60000) - (room === 'general' ? 5 : 90 + 40 * Object.keys(SEED_COUNTS).indexOf(room)) * 60000;
    }).sort((a, b) => a - b);
    const roomMsgs = [];
    times.forEach((ts, i) => {
      const text = pool[(i * 7 + Math.floor(rand() * 3)) % pool.length];
      const user = users[Math.floor(rand() * users.length)];
      const msg = { _id: makeId(ts, ++seq), user, message: text, room, reactions: [], createdAt: new Date(ts).toISOString(), updatedAt: new Date(ts).toISOString() };
      if (i > 2 && rand() < 0.14) {
        const parent = roomMsgs[roomMsgs.length - 1 - Math.floor(rand() * 2)];
        if (parent && parent.user !== user) msg.replyTo = { _id: parent._id, user: parent.user, message: parent.message.slice(0, 140) };
      }
      if (rand() < 0.2) {
        const emoji = REACTIONS[Math.floor(rand() * REACTIONS.length)];
        const who = users.filter((u) => u !== user).slice(0, 1 + Math.floor(rand() * 2));
        if (who.length) msg.reactions.push({ emoji, users: who });
      }
      roomMsgs.push(msg);
    });
    messages.push(...roomMsgs);
  }
  messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a._id < b._id ? -1 : 1));
  return { version: 1, rooms: SEED_ROOMS.map((r) => ({ ...r, createdBy: '' })), messages, seq };
}
