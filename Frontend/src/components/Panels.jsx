import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Message from './Message.jsx';
import Composer from './Composer.jsx';
import { dayLabel } from '../lib/format.js';

function Panel({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside className={`panel${wide ? ' panel-wide' : ''}`} aria-label={title} ref={ref}>
      <div className="panel-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><Icon name="close" /></button>
      </div>
      {children}
    </aside>
  );
}

const asItem = (m) => ({ message: m, grouped: false, newDay: false });

export function ThreadPanel({ engine, channel, rootId, ctx, onClose, toast }) {
  const list = engine.thread(channel, rootId);
  const root = list.find((m) => m.id === rootId);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [list.length]);
  return (
    <Panel title="Thread" onClose={onClose} wide>
      <div className="panel-body thread-body" role="log" aria-label="Thread messages">
        {!root && <p className="muted pad">This message is not loaded yet.</p>}
        {list.map((m) => <Message key={m.id} item={asItem(m)} ctx={ctx} compact />)}
        <div ref={endRef} />
      </div>
      {root && !root.deleted && (
        <Composer key={`thread-${rootId}`} channel={channel} draftKey={`${channel}#${rootId}`} engine={engine} people={[]} reply={{ id: rootId, name: root.name, text: root.text }}
          onCancelReply={() => {}} onCancelEdit={() => {}} onEditLast={() => {}} toast={toast} placeholder="Reply in thread" ariaLabel="Thread reply" />
      )}
    </Panel>
  );
}

export function PinsPanel({ engine, channel, ctx, onClose, onJump }) {
  const pins = engine.pins(channel);
  return (
    <Panel title="Pinned messages" onClose={onClose}>
      <div className="panel-body">
        {!pins.length && <p className="muted pad">No pinned messages. Use the message menu to pin important ones.</p>}
        {pins.map((m) => (
          <div key={m.id} className="pin-row">
            <Message item={asItem(m)} ctx={ctx} readOnly compact />
            <button type="button" className="btn btn-sm" onClick={() => onJump(m)}>Show in chat</button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function SearchPanel({ engine, channel, ctx, onClose, onOpen }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('here');
  const [found, setFound] = useState({ key: '', list: [] });
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);

  const key = `${q.trim()}|${scope}|${channel}`;
  const enough = q.trim().length >= 2;
  useEffect(() => {
    if (!enough) return undefined;
    let live = true;
    const t = setTimeout(async () => {
      const list = await engine.search(q, { c: scope === 'here' ? channel : null });
      if (live) setFound({ key, list });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, scope, channel, engine, key, enough]);
  const busy = enough && found.key !== key;
  const results = enough && !busy ? found.list : null;

  return (
    <Panel title="Search" onClose={onClose}>
      <div className="panel-search">
        <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages" />
        <div className="seg" role="radiogroup" aria-label="Where to search">
          <button type="button" role="radio" aria-checked={scope === 'here'} className={scope === 'here' ? 'on' : ''} onClick={() => setScope('here')}>This chat</button>
          <button type="button" role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Everywhere</button>
        </div>
        <p className="muted" aria-live="polite">{busy ? 'Searching...' : results ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : 'Type at least 2 characters. Searches messages stored on this device.'}</p>
      </div>
      <div className="panel-body">
        {(results || []).map((m) => (
          <div key={m.id} className="result">
            <p className="muted result-meta">{scope === 'all' ? `${m.c.startsWith('dm:') ? 'Direct message' : `#${m.c}`} - ` : ''}{dayLabel(m.ts)}</p>
            <Message item={asItem(m)} ctx={ctx} readOnly compact highlight={q.trim()} />
            <button type="button" className="btn btn-sm" onClick={() => onOpen(m)}>Show in chat</button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
