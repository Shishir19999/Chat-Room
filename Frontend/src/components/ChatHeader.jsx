import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';

const STATUS = {
  connecting: ['Connecting', 'warn'],
  connected: ['Connected', 'ok'],
  reconnecting: ['Reconnecting', 'warn'],
  disconnected: ['Offline', 'bad'],
};

export default function ChatHeader({ room, description, status, online, me, onMenu, onSearch, searching, onMention }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const [label, tone] = STATUS[status] || STATUS.connecting;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <header className="chat-header">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open rooms menu" aria-controls="sidebar"><Icon name="menu" /></button>
      <div className="room-title">
        <h1><span aria-hidden="true">#</span>{room}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="header-actions">
        <span className={`status status-${tone}`} role="status"><span className="dot" aria-hidden="true" />{label}</span>
        <div className="online-wrap" ref={wrap}>
          <button type="button" className="btn btn-sm online-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
            <Icon name="users" size={16} /> <span>{online.length}</span><span className="sr-only"> people online</span>
          </button>
          {open && (
            <div className="popover online-list" role="group" aria-label="People online">
              <p className="popover-title">Online in #{room}</p>
              <ul>
                {online.map((u) => (
                  <li key={u}>
                    <Avatar name={u} size={26} />
                    <span>{u}{u === me ? ' (you)' : ''}</span>
                    {u !== me && <button type="button" className="link-btn" onClick={() => { setOpen(false); onMention(u); }}>Mention</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <button type="button" className={`icon-btn${searching ? ' active' : ''}`} onClick={onSearch} aria-label="Search messages" aria-pressed={searching}><Icon name="search" /></button>
      </div>
    </header>
  );
}
