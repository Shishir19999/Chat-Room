import { Link } from 'react-router-dom';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { RoomSkeletons } from './Skeleton.jsx';
import { relativeShort } from '../lib/text.js';

export default function Sidebar({ open, onClose, chat, room, user, onLogout, onNewRoom, theme, onToggleTheme, soundOn, onToggleSound }) {
  const { rooms, roomsPhase, unread } = chat;
  return (
    <>
      <div className={`sidebar-backdrop${open ? ' open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar${open ? ' open' : ''}`} id="sidebar" aria-label="Rooms">
        <div className="sidebar-head">
          <Link to="/" className="brand" onClick={onClose}><Icon name="chat" size={22} /> Chat Room</Link>
          <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close sidebar"><Icon name="close" /></button>
        </div>

        <div className="sidebar-section-title">
          <span id="rooms-label">Rooms</span>
          <button type="button" className="icon-btn sm" onClick={onNewRoom} aria-label="Create a room"><Icon name="plus" size={18} /></button>
        </div>

        <nav className="room-nav" aria-labelledby="rooms-label">
          {roomsPhase === 'loading' && <RoomSkeletons />}
          {roomsPhase === 'error' && (
            <div className="state compact" role="alert">
              <p>Could not load rooms.</p>
              <button type="button" className="btn btn-sm" onClick={chat.retryRooms}><Icon name="refresh" size={14} /> Retry</button>
            </div>
          )}
          {roomsPhase === 'ready' && rooms.length === 0 && <p className="muted pad">No rooms yet. Create the first one.</p>}
          <ul>
            {rooms.map((r) => {
              const count = unread[r.name] || 0;
              const current = r.name === room;
              return (
                <li key={r.name}>
                  <Link to={`/chat/${r.name}`} className={`room-link${current ? ' current' : ''}`} aria-current={current ? 'page' : undefined} onClick={onClose}>
                    <Icon name="hash" size={16} />
                    <span className="room-name">{r.name}</span>
                    {r.lastAt && !count && <span className="room-time">{relativeShort(r.lastAt)}</span>}
                    {count > 0 && <span className="badge" aria-label={`${count} unread ${count === 1 ? 'message' : 'messages'}`}>{count > 99 ? '99+' : count}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-foot">
          <div className="user-card">
            <Avatar name={user} size={34} />
            <div className="user-meta">
              <strong>{user}</strong>
              <span className="muted">Signed in</span>
            </div>
          </div>
          <div className="foot-actions">
            <button type="button" className="icon-btn" onClick={onToggleSound} aria-pressed={soundOn} aria-label={soundOn ? 'Mute notification sound' : 'Enable notification sound'} title={soundOn ? 'Sound on' : 'Sound off'}>
              <Icon name={soundOn ? 'bell' : 'bellOff'} />
            </button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button type="button" className="icon-btn" onClick={onLogout} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
