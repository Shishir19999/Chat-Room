import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Message from './Message.jsx';
import Icon from './Icon.jsx';
import { MessageSkeletons } from './Skeleton.jsx';
import { dayLabel, decorateMessages } from '../lib/text.js';

export default function MessageList({ chat, room, me, actions }) {
  const { messages, phase, error, hasMore, loadingOlder } = chat;
  const scroller = useRef(null);
  const prev = useRef({ first: null, last: null, height: 0, room: null });
  const nearBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const rows = useMemo(() => decorateMessages(messages), [messages]);

  const toBottom = (smooth) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const p = prev.current;
    const first = messages[0]?._id ?? null;
    const last = messages.at(-1)?._id ?? null;
    if (p.room !== room || p.last === null) {
      toBottom(false);
      setUnseen(false);
    } else if (first !== p.first && last === p.last) {
      el.scrollTop += el.scrollHeight - p.height; // older page prepended: keep position
    } else if (last !== p.last) {
      if (nearBottom.current || messages.at(-1)?.user === me) { toBottom(true); setUnseen(false); }
      else setUnseen(true);
    }
    prev.current = { first, last, height: el.scrollHeight, room };
  }, [messages, room, me]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onScroll = () => {
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      if (nearBottom.current) setUnseen(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  let body;
  if (phase === 'loading') body = <MessageSkeletons />;
  else if (phase === 'error') {
    body = (
      <div className="state" role="alert">
        <h3>Could not load messages</h3>
        <p>{error || 'Something went wrong.'}</p>
        <button type="button" className="btn btn-primary" onClick={chat.retry}><Icon name="refresh" size={16} /> Try again</button>
      </div>
    );
  } else if (messages.length === 0) {
    body = (
      <div className="state">
        <div className="state-art" aria-hidden="true">💬</div>
        <h3>No messages in #{room} yet</h3>
        <p>Be the first to say something. Say hi, share an idea or paste an image.</p>
      </div>
    );
  } else {
    body = (
      <ol className="messages" aria-label={`Messages in ${room}`}>
        {hasMore && (
          <li className="older">
            <button type="button" className="btn btn-sm" data-testid="load-older" onClick={actions.loadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading...' : 'Load older messages'}
            </button>
          </li>
        )}
        {rows.map(({ message, newDay, grouped }) => (
          <MessageRow key={message._id} message={message} newDay={newDay} grouped={grouped} me={me} actions={actions} />
        ))}
      </ol>
    );
  }

  return (
    <div className="message-area">
      <div className="message-scroll" ref={scroller} tabIndex={-1}>{body}</div>
      {unseen && (
        <button type="button" className="jump-btn" onClick={() => { toBottom(true); setUnseen(false); }}>
          <Icon name="down" size={16} /> New messages
        </button>
      )}
    </div>
  );
}

function MessageRow({ message, newDay, grouped, me, actions }) {
  return (
    <>
      {newDay && <li className="day-sep" role="separator" aria-label={dayLabel(message.createdAt)}><span>{dayLabel(message.createdAt)}</span></li>}
      <Message
        message={message}
        grouped={grouped && !newDay}
        me={me}
        onReply={actions.reply}
        onReact={actions.react}
        onEdit={actions.edit}
        onDelete={actions.askDelete}
        onOpenImage={actions.openImage}
      />
    </>
  );
}
