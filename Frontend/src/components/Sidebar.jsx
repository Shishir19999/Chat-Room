import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { avatarColor } from '../lib/format.js';

const PRESENCE_LABEL = { online: 'Online', idle: 'Idle', away: 'Away', offline: 'Offline' };

function Badge({ n, mention }) {
  if (!n) return null;
  return <span className={`badge${mention ? ' badge-mention' : ''}`} aria-label={`${n} unread${mention ? `, ${mention} mention${mention === 1 ? '' : 's'}` : ''}`}>{n > 99 ? '99+' : n}</span>;
}

export default function Sidebar({ snap, active, onSelect, onSwitcher, onCreate, onInvite, onSettings, onUser, onLeave, open, onClose }) {
  const channels = snap.channels.filter((c) => c.type === 'channel');
  const chats = snap.channels.filter((c) => c.type !== 'channel').sort((a, b) => (b.lastLc || 0) - (a.lastLc || 0));
  const online = snap.people.filter((p) => p.online);
  const offline = snap.people.filter((p) => !p.online);
  const isPrivate = snap.ws.password;

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Conversations and people">
      <div className="side-head">
        <div className="side-title">
          <span className="ws-icon" aria-hidden="true"><Icon name={isPrivate ? 'lock' : 'globe'} size={18} /></span>
          <div>
            <h2>{snap.ws.name}</h2>
            <p className="muted">{isPrivate ? 'Private room' : 'Public room'}</p>
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onInvite} aria-label="Invite people"><Icon name="userPlus" /></button>
        <button type="button" className="icon-btn side-close" onClick={onClose} aria-label="Close sidebar"><Icon name="close" /></button>
      </div>

      <button type="button" className="switcher-btn" onClick={onSwitcher}>
        <Icon name="search" size={16} /> <span>Jump to...</span> <kbd>Ctrl K</kbd>
      </button>

      <nav className="side-scroll" aria-label="Channels and chats">
        <section aria-labelledby="sec-channels">
          <div className="sec-head"><h3 id="sec-channels">Channels</h3><button type="button" className="icon-btn" onClick={() => onCreate('channel')} aria-label="Create a channel"><Icon name="plus" size={16} /></button></div>
          <ul>
            {channels.map((c) => (
              <li key={c.key}>
                <button type="button" className={`nav-item${active === c.key ? ' active' : ''}${c.unread ? ' unread' : ''}`} aria-current={active === c.key ? 'page' : undefined} onClick={() => onSelect(c.key)}>
                  <Icon name="hash" size={16} /><span className="nav-label">{c.name}</span><Badge n={c.unread} mention={c.mentions} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sec-chats">
          <div className="sec-head"><h3 id="sec-chats">Direct messages</h3><button type="button" className="icon-btn" onClick={() => onCreate('group')} aria-label="Start a group chat"><Icon name="users" size={16} /></button></div>
          <ul>
            {chats.map((c) => (
              <li key={c.key}>
                <button type="button" className={`nav-item${active === c.key ? ' active' : ''}${c.unread ? ' unread' : ''}`} aria-current={active === c.key ? 'page' : undefined} onClick={() => onSelect(c.key)}>
                  {c.type === 'dm' ? <Avatar name={c.name} color={c.color} size={22} presence={c.online ? 'online' : 'offline'} /> : <span className="group-icon" aria-hidden="true"><Icon name="users" size={14} /></span>}
                  <span className="nav-label">{c.name}</span><Badge n={c.unread} mention={c.mentions} />
                </button>
              </li>
            ))}
            {!chats.length && <li className="muted pad-sm">Pick someone below to start a private chat.</li>}
          </ul>
        </section>

        <section aria-labelledby="sec-people">
          <div className="sec-head"><h3 id="sec-people">People online <span className="count">{online.length + 1}</span></h3></div>
          <ul>
            <li>
              <button type="button" className="nav-item" onClick={onSettings} aria-label={`${snap.me.name} (you), ${PRESENCE_LABEL[snap.me.presence]}. Open settings`}>
                <Avatar name={snap.me.name} color={snap.me.color} size={22} presence={snap.me.presence} />
                <span className="nav-label">{snap.me.name} <span className="muted">(you)</span></span>
              </button>
            </li>
            {online.map((p) => (
              <li key={p.uid}>
                <button type="button" className="nav-item" onClick={() => onUser(p.uid)} aria-label={`${p.name}, ${PRESENCE_LABEL[p.presence]}${p.status ? `, ${p.status}` : ''}`}>
                  <Avatar name={p.name} color={p.color} size={22} presence={p.presence} />
                  <span className="nav-label">{p.name}{p.status && <small className="status-text">{p.status}</small>}</span>
                </button>
              </li>
            ))}
            {!online.length && <li className="muted pad-sm">Nobody else is here right now.</li>}
          </ul>
          {offline.length > 0 && (
            <details className="earlier">
              <summary>Earlier visitors ({offline.length})</summary>
              <ul>
                {offline.map((p) => (
                  <li key={p.uid}>
                    <button type="button" className="nav-item dim" onClick={() => onUser(p.uid)}>
                      <span className="avatar" style={{ '--size': '22px', background: avatarColor(p.color) }} aria-hidden="true">{p.name.slice(0, 2).toUpperCase()}</span>
                      <span className="nav-label">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </nav>

      <div className="side-foot">
        <button type="button" className="me-card" onClick={onSettings}>
          <Avatar name={snap.me.name} color={snap.me.color} size={32} presence={snap.me.presence} />
          <span className="me-text"><strong>{snap.me.name}</strong><small>{snap.me.status || PRESENCE_LABEL[snap.me.presence]}</small></span>
          <Icon name="settings" size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={onLeave} aria-label="Leave room"><Icon name="logout" /></button>
      </div>
    </aside>
  );
}
