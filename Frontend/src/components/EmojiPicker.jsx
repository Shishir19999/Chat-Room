import { useEffect, useRef, useState } from 'react';
import { EMOJI_CATEGORIES, STICKER_PACKS, searchEmoji } from '../core/emoji.js';
import Icon from './Icon.jsx';

// Small accessible emoji and sticker picker (all data is bundled; nothing is fetched).
export default function EmojiPicker({ onPick, onSticker, onClose, label = 'Emoji picker', anchor = 'up' }) {
  const [tab, setTab] = useState('emoji');
  const [cat, setCat] = useState(0);
  const [pack, setPack] = useState(0);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    const node = ref.current;
    node.querySelector('input')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    const onDown = (e) => { if (!node.contains(e.target) && !e.target.closest('[data-picker-trigger]')) closeRef.current(); };
    node.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { node.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, []);

  const results = query ? searchEmoji(query) : EMOJI_CATEGORIES[cat].items;
  return (
    <div className={`picker picker-${anchor}`} role="dialog" aria-label={label} ref={ref}>
      <div className="picker-head">
        <div className="tabs" role="tablist" aria-label="Picker type">
          <button type="button" role="tab" aria-selected={tab === 'emoji'} className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>Emoji</button>
          {onSticker && <button type="button" role="tab" aria-selected={tab === 'stickers'} className={tab === 'stickers' ? 'on' : ''} onClick={() => setTab('stickers')}>Stickers</button>}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close picker"><Icon name="close" size={16} /></button>
      </div>
      {tab === 'emoji' ? (
        <>
          <input type="search" className="picker-search" placeholder="Search emoji" aria-label="Search emoji" value={query} onChange={(e) => setQuery(e.target.value)} />
          {!query && (
            <div className="picker-cats" role="tablist" aria-label="Emoji categories">
              {EMOJI_CATEGORIES.map((c, i) => (
                <button key={c.id} type="button" role="tab" aria-selected={i === cat} aria-label={c.label} className={i === cat ? 'on' : ''} onClick={() => setCat(i)}>{c.icon}</button>
              ))}
            </div>
          )}
          <div className="picker-grid" role="group" aria-label={query ? 'Search results' : EMOJI_CATEGORIES[cat].label}>
            {results.map((it) => (
              <button key={it.emoji} type="button" className="emoji" title={it.words.split(' ')[0]} aria-label={it.words.split(' ')[0] || it.emoji} onClick={() => onPick(it.emoji)}>{it.emoji}</button>
            ))}
            {!results.length && <p className="muted pad">No emoji found.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="picker-cats" role="tablist" aria-label="Sticker packs">
            {STICKER_PACKS.map((p, i) => (
              <button key={p.id} type="button" role="tab" aria-selected={i === pack} className={`wide ${i === pack ? 'on' : ''}`} onClick={() => setPack(i)}>{p.label}</button>
            ))}
          </div>
          <div className="sticker-grid" role="group" aria-label={`${STICKER_PACKS[pack].label} stickers`}>
            {STICKER_PACKS[pack].items.map(([emoji, caption]) => (
              <button key={caption} type="button" className="sticker" onClick={() => onSticker(emoji, caption)}>
                <span aria-hidden="true">{emoji}</span>
                <small>{caption}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
