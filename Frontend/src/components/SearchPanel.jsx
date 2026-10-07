import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import RichText from './RichText.jsx';
import { MessageSkeletons } from './Skeleton.jsx';
import { dayLabel, formatTime } from '../lib/text.js';

export default function SearchPanel({ room, me, search, onClose }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ phase: 'idle', rows: [], hasMore: false, next: null, error: '' });
  const token = useRef(0);
  const q = query.trim();

  useEffect(() => {
    const id = ++token.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!q) { setState({ phase: 'idle', rows: [], hasMore: false, next: null, error: '' }); return undefined; }
    setState((s) => ({ ...s, phase: 'loading', error: '' }));
    const t = setTimeout(async () => {
      try {
        const page = await search(q);
        if (id === token.current) setState({ phase: 'done', rows: [...page.data].reverse(), hasMore: page.hasMore, next: page.nextBefore, error: '' });
      } catch (e) {
        if (id === token.current) setState({ phase: 'error', rows: [], hasMore: false, next: null, error: e.message });
      }
    }, 280);
    return () => clearTimeout(t);
  }, [q, search, room]);

  const more = async () => {
    const id = token.current;
    const page = await search(q, { before: state.next });
    if (id === token.current) setState((s) => ({ ...s, rows: [...s.rows, ...[...page.data].reverse()], hasMore: page.hasMore, next: page.nextBefore }));
  };

  return (
    <section className="search-panel" aria-label="Search messages">
      <form className="search-bar" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" size={18} />
        <label className="sr-only" htmlFor="search-input">Search messages in #{room}</label>
        <input id="search-input" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search #${room}`} maxLength={100} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} />
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </form>
      <div className="search-results" aria-live="polite">
        {state.phase === 'idle' && <p className="state-text">Type to search the messages of #{room}.</p>}
        {state.phase === 'loading' && <MessageSkeletons rows={3} />}
        {state.phase === 'error' && (
          <div className="state compact" role="alert">
            <p>{state.error}</p>
            <button type="button" className="btn btn-sm" onClick={() => setQuery((v) => `${v} `)}>Try again</button>
          </div>
        )}
        {state.phase === 'done' && state.rows.length === 0 && <p className="state-text">No messages match &ldquo;{q}&rdquo;.</p>}
        {state.phase === 'done' && state.rows.length > 0 && (
          <>
            <p className="muted pad">{state.rows.length}{state.hasMore ? '+' : ''} {state.rows.length === 1 ? 'result' : 'results'}</p>
            <ul className="result-list">
              {state.rows.map((m) => (
                <li key={m._id} className="result">
                  <Avatar name={m.user} size={28} />
                  <div>
                    <div className="msg-head"><span className="msg-user">{m.user}</span><time dateTime={m.createdAt}>{dayLabel(m.createdAt)}, {formatTime(m.createdAt)}</time></div>
                    <p className="msg-text"><RichText text={m.message} me={me} query={q} /></p>
                  </div>
                </li>
              ))}
            </ul>
            {state.hasMore && <div className="older"><button type="button" className="btn btn-sm" onClick={more}>Show older results</button></div>}
          </>
        )}
      </div>
    </section>
  );
}
