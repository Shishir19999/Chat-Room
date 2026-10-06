// Idempotent seed: ~400 messages over 6 rooms by 12 usernames. Run with `npm run seed`.
// Deterministic (faker seed 77, fixed reference date). Upserts by {room, user, timestamp}.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { faker } from '@faker-js/faker';
import ChatMessage from '../models/ChatMessage.js';

dotenv.config();
faker.seed(77);

const users = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'nina'];
const rooms = { general: 90, dev: 85, random: 65, design: 55, support: 55, music: 50 };
const REF = Date.parse('2026-09-30T18:00:00Z');
const DAY = 24 * 3600 * 1000;

const pools = {
  general: ['Good morning everyone!', 'Anyone up for a quick sync at {t}?', 'Reminder: standup moved to {t}.', 'Welcome to the new folks, glad to have you here.', 'Has anyone seen the latest announcement?', 'Thanks all, have a great weekend!', 'Lunch plans today?', 'The release notes are up on the wiki.', 'Happy Friday!', 'Who is covering the on-call rotation this week?'],
  dev: ['The build on main is {s}.', 'Opened a PR for the {x} refactor, reviews welcome.', 'Can someone look at the flaky {x} test?', 'Merged. Deploying to staging now.', 'I think the {x} bug is a race condition.', 'Bumped dependencies, please pull before pushing.', 'Latency on the {x} endpoint dropped by 30%.', 'Rolling back the last deploy, error rate spiked.', 'Added logging around {x}, check the dashboard.', 'Code review done, left a few nits.'],
  random: ['Coffee or tea?', 'Just watched a great documentary about {x}.', 'Anyone tried the new place downtown?', 'Hot take: tabs are better than spaces.', 'Look at this cat photo!', 'Weekend hike was amazing.', 'Book recommendations, anyone?', 'It is raining again, classic.', 'Trivia: octopuses have three hearts.', 'Who is watching the game tonight?'],
  design: ['Updated the {x} mockups in Figma.', 'Do we want rounded or sharp corners here?', 'The contrast on the {x} button fails accessibility.', 'New icon set is ready for review.', 'Can we align the grid to 8px?', 'Dark mode palette draft is attached.', 'User testing showed confusion around {x}.', 'Love the new typography, nicely done.', 'Handoff spec for {x} is complete.', 'Let us simplify the onboarding flow.'],
  support: ['Ticket #{n} is escalated to tier 2.', 'Customer reports they cannot reset their password.', 'Resolved #{n}, customer confirmed it works.', 'We have seen {n} similar reports today.', 'Please add a note to the knowledge base for {x}.', 'Waiting on logs from the customer.', 'SLA for #{n} is about to breach, can someone assist?', 'Thanks for the quick turnaround!', 'Known issue with {x}, workaround posted.', 'Closing the ticket after no response.'],
  music: ['Currently listening to {x} on repeat.', 'Any good playlists for coding?', 'Saw them live last night, incredible show.', 'Vinyl or streaming?', 'That album is a masterpiece.', 'Anyone play an instrument here?', 'Sharing my {x} mix for the weekend.', 'The bassline on that track is unreal.', 'Concert tickets go on sale tomorrow.', 'Lo-fi beats are my focus music.'],
};
const topics = ['login', 'checkout', 'search', 'billing', 'dashboard', 'API', 'cache', 'mobile app', 'jazz', 'synthwave', 'space', 'chess', 'notifications', 'settings'];
const statuses = ['green', 'red', 'flaky', 'passing now'];
const fill = (s) => s.replace('{x}', faker.helpers.arrayElement(topics))
  .replace('{t}', `${faker.number.int({ min: 9, max: 17 })}:${faker.helpers.arrayElement(['00', '15', '30', '45'])}`)
  .replace('{s}', faker.helpers.arrayElement(statuses))
  .replace('{n}', String(faker.number.int({ min: 1000, max: 9999 })));

const docs = [];
for (const [room, count] of Object.entries(rooms)) {
  const members = faker.helpers.shuffle(users).slice(0, room === 'general' ? 12 : 7);
  for (let i = 0; i < count; i++) {
    // spread across the last 21 days; "- i" keeps timestamps unique per room
    const day = faker.number.int({ min: 0, max: 20 });
    const ms = REF - day * DAY - faker.number.int({ min: 0, max: 9 * 3600 }) * 1000 - i;
    docs.push({ room, user: faker.helpers.arrayElement(members), message: fill(faker.helpers.arrayElement(pools[room])), ts: new Date(ms) });
  }
}

await mongoose.connect(process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/chatroom');
// remove the legacy tiny seed conversation (relative timestamps) so it is not duplicated
const legacy = [
  ['general', 'alice', 'Hi everyone, welcome to the chat room!'],
  ['general', 'bob', 'Hey Alice! Good to be here.'],
  ['general', 'carol', 'Hello all. Is anyone working on the release today?'],
  ['general', 'alice', 'Yes, I am finishing the final checks now.'],
  ['general', 'bob', 'Great, ping me if you need a review.'],
  ['dev', 'dave', 'Anyone seen the failing build on main?'],
  ['dev', 'erin', 'Yes, it is a flaky test, re-running the pipeline.'],
  ['dev', 'dave', 'Thanks, merging after it goes green.'],
  ['random', 'bob', 'Coffee or tea?'],
  ['random', 'carol', 'Coffee, always.'],
];
await ChatMessage.deleteMany({ $or: legacy.map(([room, user, message]) => ({ room, user, message, timestamp: { $gt: new Date(REF) } })) });
let added = 0;
for (const d of docs) {
  const r = await ChatMessage.updateOne(
    { room: d.room, user: d.user, timestamp: d.ts },
    { $setOnInsert: { room: d.room, user: d.user, message: d.message, timestamp: d.ts, createdAt: d.ts, updatedAt: d.ts } },
    { upsert: true, timestamps: false },
  );
  if (r.upsertedCount) added++;
}
console.log(`Seed done: ${added} new messages (total: ${await ChatMessage.countDocuments()}) in "${mongoose.connection.name}".`);
await mongoose.disconnect();
