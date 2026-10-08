// A compact bundled emoji set (no external data or network) with search keywords, plus sticker packs.
const parse = (text) => text.trim().split('\n').map((line) => {
  const [emoji, words] = line.split('|');
  return { emoji: emoji.trim(), words: (words || '').trim() };
});

export const EMOJI_CATEGORIES = [
  {
    id: 'smileys', label: 'Smileys', icon: '😀', items: parse(`
😀|grin happy smile
😃|smile open happy
😄|smile laugh happy
😁|beam grin
😆|laugh squint
😅|sweat relief nervous
😂|joy tears laugh lol
🤣|rofl floor laugh
🙂|slight smile
😉|wink
😊|blush smile
😇|angel halo innocent
🥰|love hearts adore
😍|heart eyes love
🤩|star struck wow
😘|kiss
😋|yum tasty
😎|cool sunglasses
🤓|nerd glasses
🥳|party celebrate
😏|smirk
😌|relieved calm
😴|sleep tired zzz
🤔|think hmm
🫡|salute
😬|grimace awkward
🙄|eye roll
😢|cry sad tear
😭|sob crying
😤|huff triumph
😡|angry mad
🥺|pleading puppy
😱|scream shock
🤯|mind blown explode
😳|flushed embarrassed
🤗|hug
🤫|shush quiet secret
🫠|melt
😶|speechless
🥲|smile tear proud
😮|surprised wow
😴|sleepy
🤒|sick ill
🤮|vomit
🥶|cold freezing
🥵|hot sweating
`),
  },
  {
    id: 'people', label: 'People', icon: '👋', items: parse(`
👋|wave hello hi bye
🤚|raised hand
✋|stop high five
👌|ok perfect
✌️|peace victory
🤞|fingers crossed luck
🤟|love you
🤘|rock
👍|thumbs up yes good like
👎|thumbs down no bad
👏|clap applause
🙌|raised hands hooray
🙏|pray thanks please
💪|strong muscle flex
🫶|heart hands
🤝|handshake deal
✍️|write
💅|nails
👀|eyes look
🧠|brain smart
❤️|red heart love
🧡|orange heart
💛|yellow heart
💚|green heart
💙|blue heart
💜|purple heart
🖤|black heart
💔|broken heart
💯|hundred perfect
✨|sparkles magic
🔥|fire hot lit
💬|speech bubble chat
🎉|party popper tada
`),
  },
  {
    id: 'nature', label: 'Nature', icon: '🌱', items: parse(`
🐶|dog puppy
🐱|cat kitten
🐭|mouse
🐹|hamster
🦊|fox
🐻|bear
🐼|panda
🐨|koala
🦁|lion
🐯|tiger
🐸|frog
🐵|monkey
🙈|see no evil
🦄|unicorn
🐝|bee
🦋|butterfly
🐢|turtle
🐙|octopus
🐬|dolphin
🌱|seedling plant
🌳|tree
🌸|blossom flower
🌻|sunflower
🌈|rainbow
☀️|sun sunny
🌙|moon night
⭐|star
⚡|lightning zap
❄️|snow cold
🌊|wave ocean
🍀|clover luck
🌵|cactus
`),
  },
  {
    id: 'food', label: 'Food', icon: '🍕', items: parse(`
🍎|apple
🍌|banana
🍓|strawberry
🍇|grapes
🍉|watermelon
🥑|avocado
🌽|corn
🥕|carrot
🍕|pizza
🍔|burger
🌭|hot dog
🌮|taco
🍣|sushi
🍜|noodles ramen
🍝|pasta spaghetti
🥗|salad
🍩|donut
🍪|cookie
🎂|cake birthday
🍫|chocolate
🍿|popcorn
☕|coffee
🍵|tea
🧋|bubble tea
🍺|beer
🍷|wine
🥂|cheers toast
🧀|cheese
`),
  },
  {
    id: 'activity', label: 'Activity', icon: '🎮', items: parse(`
⚽|soccer football
🏀|basketball
🏈|american football
🎾|tennis
🏐|volleyball
🎯|target dart bullseye
🎮|game controller
🕹️|joystick
🎲|dice
♟️|chess
🎸|guitar
🎹|piano
🥁|drums
🎧|headphones music
🎤|microphone sing
🎬|movie film
🎨|art palette
📚|books read
🚀|rocket launch
✈️|airplane travel
🚗|car
🚲|bike
🏆|trophy win
🥇|gold medal first
🎁|gift present
💡|idea bulb
📌|pin
📎|paperclip
💻|laptop computer
📱|phone
⌨️|keyboard
🔧|wrench tool
`),
  },
  {
    id: 'symbols', label: 'Symbols', icon: '✅', items: parse(`
✅|check done yes
❌|cross no
⚠️|warning
❓|question
❗|exclamation
➕|plus add
➖|minus
➡️|right arrow
⬅️|left arrow
⬆️|up arrow
⬇️|down arrow
🔔|bell notification
🔕|mute bell
🔒|lock secure
🔓|unlock
🔗|link
⏰|alarm clock time
⌛|hourglass wait
📅|calendar date
🏁|finish flag
🚩|red flag
🆗|ok
🆕|new
💤|sleep zzz
♻️|recycle
`),
  },
];

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

export function searchEmoji(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set();
  const out = [];
  for (const cat of EMOJI_CATEGORIES) {
    for (const item of cat.items) {
      if (seen.has(item.emoji)) continue;
      if (item.words.includes(q) || item.words.split(' ').some((w) => w.startsWith(q))) { seen.add(item.emoji); out.push(item); }
    }
  }
  return out;
}

// Bundled "stickers": large emoji with a caption, grouped in packs. Sent as a message with no text.
export const STICKER_PACKS = [
  { id: 'feels', label: 'Feels', items: [['🥳', 'Party time'], ['😂', 'So funny'], ['😭', 'Crying'], ['🤯', 'Mind blown'], ['😴', 'Sleepy'], ['🥰', 'Aww'], ['😎', 'Cool'], ['🤔', 'Hmm']] },
  { id: 'cheer', label: 'Cheer', items: [['🎉', 'Hooray'], ['👏', 'Well done'], ['🙌', 'Yes!'], ['💯', 'Perfect'], ['🔥', 'On fire'], ['🏆', 'Winner'], ['🚀', 'Lift off'], ['✨', 'Magic']] },
  { id: 'pets', label: 'Pets', items: [['🐶', 'Woof'], ['🐱', 'Meow'], ['🦊', 'Clever'], ['🐼', 'Chill'], ['🦄', 'Magical'], ['🐸', 'Ribbit'], ['🐙', 'Hug'], ['🐢', 'Slow down']] },
  { id: 'food', label: 'Treats', items: [['🍕', 'Pizza?'], ['☕', 'Coffee time'], ['🍩', 'Donut'], ['🍿', 'Popcorn'], ['🎂', 'Cake'], ['🍣', 'Sushi'], ['🍫', 'Chocolate'], ['🥂', 'Cheers']] },
];
