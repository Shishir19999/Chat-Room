import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Message from './Message.jsx';
import Icon from './Icon.jsx';
import { dayLabel, decorateMessages } from '../lib/format.js';

const NEAR_BOTTOM = 80;

// The scrolling conversation: date separators, "new messages" divider, load-older, jump buttons.
export default function MessageList({ channel, messages, engine, ctx, anchor, empty }) {
  const box = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const [below, setBelow] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [dividerVisible, setDividerVisible] = useState(true);
  const stick = useRef(true);
  const prev = useRef({ channel: null, count: 0, lastId: '', height: 0, first: '' });

  const items = useMemo(() => decorateMessages(messages, { unreadAfter: anchor, me: engine.me.uid }), [messages, anchor, engine]);
  const hasDivider = items.some((i) => i.divider);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = box.current;
    if (!el) return;
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }, []);

  const jumpTo = useCallback((id) => {
    const node = box.current?.querySelector(`[data-id="${id}"]`);
    if (!node) return false;
    node.scrollIntoView({ block: 'center' });
    node.classList.add('flash');
    node.focus({ preventScroll: true });
    setTimeout(() => node.classList.remove('flash'), 1600);
    return true;
  }, []);
  useEffect(() => { ctx.registerJump?.(jumpTo); }, [ctx, jumpTo]);

  // Channel switch, new messages and prepended history keep the viewport where the reader expects it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const p = prev.current;
    const last = messages[messages.length - 1];
    const first = messages[0];
    if (p.channel !== channel) {
      const divider = el.querySelector('.new-divider');
      if (divider) divider.scrollIntoView({ block: 'start' }); else scrollToBottom();
      stick.current = !divider;
      setDone(false);
    } else if (first && p.first && first.id !== p.first && messages.length > p.count && last?.id === p.lastId) {
      el.scrollTop += el.scrollHeight - p.height; // older messages were added above
    } else if (last && last.id !== p.lastId) {
      if (stick.current || last.mine) { scrollToBottom(); stick.current = true; }
      else setBelow((n) => n + (messages.length - p.count));
    }
    prev.current = { channel, count: messages.length, lastId: last?.id || '', height: el.scrollHeight, first: first?.id || '' };
  }, [channel, messages, scrollToBottom]);

  const onScroll = () => {
    const el = box.current;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    stick.current = near;
    setAtBottom(near);
    engine.setAtBottom(near);
    if (near) setBelow(0);
    const div = el.querySelector('.new-divider');
    if (div) setDividerVisible(div.getBoundingClientRect().top < el.getBoundingClientRect().top + el.clientHeight && div.getBoundingClientRect().bottom > el.getBoundingClientRect().top);
    prev.current.height = el.scrollHeight;
  };

  const older = async () => {
    if (loading || done) return;
    setLoading(true);
    prev.current.height = box.current.scrollHeight;
    try {
      const res = await engine.loadOlder(channel);
      if (res.done) setDone(true);
    } finally { setLoading(false); }
  };

  const jumpUnread = () => {
    box.current?.querySelector('.new-divider')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };

  return (
    <div className="list-wrap">
      {hasDivider && !dividerVisible && (
        <button type="button" className="jump jump-top" onClick={jumpUnread}><Icon name="arrowDown" size={14} /> Jump to first unread</button>
      )}
      <div className="list" ref={box} onScroll={onScroll} role="log" aria-label="Messages" aria-relevant="additions" tabIndex={0}>
        <div className="list-top">
          {done || !messages.length ? <p className="muted">{messages.length ? 'You are at the start of the conversation.' : ''}</p> : (
            <button type="button" className="btn btn-quiet" onClick={older} disabled={loading}>{loading ? 'Loading...' : 'Load older messages'}</button>
          )}
        </div>
        {!messages.length && empty}
        {items.map((item) => (
          <div key={item.message.id} className="row">
            {item.newDay && <div className="day-sep" role="separator"><span>{dayLabel(item.message.ts)}</span></div>}
            {item.divider && <div className="new-divider" role="separator" aria-label="New messages"><span>New messages</span></div>}
            <Message item={item} ctx={ctx} />
          </div>
        ))}
      </div>
      {!atBottom && (
        <button type="button" className="jump jump-bottom" onClick={() => { scrollToBottom(true); setBelow(0); }} aria-label={below ? `${below} new messages, scroll to latest` : 'Scroll to latest messages'}>
          <Icon name="arrowDown" size={16} /> {below ? `${below} new` : 'Latest'}
        </button>
      )}
    </div>
  );
}
