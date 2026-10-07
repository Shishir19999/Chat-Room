/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

const CATEGORIES = [
  { id: 'smileys', label: 'Smileys', icon: '😀', items: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 😌 😴 🤔 🫡 😬 🙄 😢 😭 😤 😡 🥺 😱 🤯'.split(' ') },
  { id: 'people', label: 'People', icon: '👋', items: '👋 🤚 ✋ 👌 ✌️ 🤞 🤟 🤘 👍 👎 👏 🙌 🙏 💪 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 ✨ 🔥 💯 💬 👀'.split(' ') },
  { id: 'nature', label: 'Nature', icon: '🌱', items: '🐶 🐱 🦊 🐼 🐨 🦁 🐸 🐵 🦄 🐝 🦋 🐢 🐙 🌱 🌳 🌸 🌻 🌈 ☀️ 🌙 ⭐ ⚡ ❄️ 🌊'.split(' ') },
  { id: 'food', label: 'Food', icon: '🍕', items: '🍎 🍌 🍓 🍇 🍉 🥑 🌽 🍕 🍔 🌮 🍣 🍜 🍩 🍪 🎂 🍫 🍿 ☕ 🍵 🍺 🍷'.split(' ') },
  { id: 'activity', label: 'Activity', icon: '🎮', items: '⚽ 🏀 🎾 🎯 🎮 🎲 🎸 🎧 🎤 🎬 🎨 📚 🚀 ✈️ 🚗 🏆 🥇 🎉 🎁 💡'.split(' ') },
];

// Small accessible emoji grid. `quick` shows the one-tap reactions first.
export default function EmojiPicker({ onPick, onClose, quick = false, label = 'Emoji picker' }) {
  const [tab, setTab] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    node.querySelector('button.emoji')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onDown = (e) => { if (!node.contains(e.target) && !e.target.closest('[data-emoji-trigger]')) onClose(); };
    node.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { node.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const items = CATEGORIES[tab].items;
  return (
    <div className="emoji-picker" role="dialog" aria-label={label} ref={ref}>
      {quick && (
        <div className="emoji-quick" role="group" aria-label="Quick reactions">
          {QUICK_REACTIONS.map((e) => (
            <button type="button" key={e} className="emoji" onClick={() => onPick(e)} aria-label={`React with ${e}`}>{e}</button>
          ))}
        </div>
      )}
      <div className="emoji-tabs" role="tablist" aria-label="Emoji categories">
        {CATEGORIES.map((c, i) => (
          <button type="button" role="tab" key={c.id} aria-selected={i === tab} aria-label={c.label} className={`emoji-tab${i === tab ? ' active' : ''}`} onClick={() => setTab(i)}>{c.icon}</button>
        ))}
      </div>
      <div className="emoji-grid" role="tabpanel">
        {items.map((e) => (
          <button type="button" key={e} className="emoji" onClick={() => onPick(e)} aria-label={e}>{e}</button>
        ))}
      </div>
    </div>
  );
}
