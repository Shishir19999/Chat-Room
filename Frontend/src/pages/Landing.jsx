import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import ParallaxScene from '../components/Parallax.jsx';
import Reveal from '../components/Reveal.jsx';
import { DemoBanner } from '../components/Banners.jsx';
import { API_URL, MODE } from '../app/session.js';
import { COLORS, LOBBY, PUBLIC_NOTICE } from '../core/constants.js';
import { cleanWorkspace } from '../core/ops.js';
import { KEYS, readJson, writeJson, writeSession } from '../lib/storage.js';
import { validateName, validatePassword, validateRoomName } from '../lib/validate.js';

const INITIAL_COLOR = COLORS[Math.floor(Math.random() * COLORS.length)];

const FEATURES = [
  { icon: 'bolt', title: 'Truly live', text: 'Messages, typing, presence and read receipts arrive the moment they happen.' },
  { icon: 'lock', title: 'Private rooms', text: 'Protect a room with a password and share one invite link. Direct messages and group chats stay between their members.' },
  { icon: 'thread', title: 'Threads and replies', text: 'Reply to any message, follow a thread, react with emoji and pin what matters.' },
  { icon: 'mic', title: 'Voice, pictures, files', text: 'Record a voice note, drop in a picture or send a file up to 5 MB. Nothing loads until you tap it.' },
  { icon: 'search', title: 'Search and history', text: 'Your history is kept on your device. Search it and load older messages any time.' },
  { icon: 'shield', title: 'Safe by default', text: 'Mute, block and hide people, rate limits, safe formatting and an optional family friendly filter.' },
];

function recentRooms() {
  const list = readJson(KEYS.rooms, []);
  return Array.isArray(list) ? list.filter((r) => r && typeof r.name === 'string').slice(0, 6) : [];
}

export default function Landing({ theme, onToggleTheme }) {
  const navigate = useNavigate();
  const params = useParams();
  const [search] = useSearchParams();
  const invited = params.ws ? cleanWorkspace(params.ws) : '';
  const saved = readJson(KEYS.profile, null);
  const [name, setName] = useState(saved?.name || '');
  const [color, setColor] = useState(saved?.color ?? INITIAL_COLOR);
  const [mode, setMode] = useState(invited ? 'room' : 'lobby');
  const [room, setRoom] = useState(invited && invited !== LOBBY ? invited : '');
  const [password, setPassword] = useState(search.get('k') || '');
  const [errors, setErrors] = useState({});
  const [active, setActive] = useState([]);

  useEffect(() => {
    if (MODE !== 'socket') return undefined;
    let live = true;
    fetch(`${API_URL}/rooms`).then((r) => r.json()).then((body) => { if (live) setActive(body.data || []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const enter = (ws, pw) => {
    const profile = { name: name.trim(), color, status: saved?.status || '' };
    writeJson(KEYS.profile, profile);
    const rooms = [{ name: ws, private: Boolean(pw), at: Date.now() }, ...recentRooms().filter((r) => r.name !== ws)].slice(0, 6);
    writeJson(KEYS.rooms, rooms);
    writeSession(`chat:pw:${ws}`, pw || null);
    navigate(`/chat/${ws}`);
  };

  const submit = (e) => {
    e.preventDefault();
    const next = { name: validateName(name) };
    const target = mode === 'lobby' ? LOBBY : cleanWorkspace(room);
    if (mode === 'room') { next.room = validateRoomName(room); next.password = validatePassword(password); }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    enter(target, mode === 'room' ? password : '');
  };

  return (
    <div className="landing">
      {MODE === 'p2p' && <DemoBanner />}
      <header className="landing-bar">
        <span className="brand"><Icon name="chat" size={22} /> Chat Room</span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>
      <main id="main">
        <ParallaxScene as="section" className="hero" aria-labelledby="hero-title">
          <div className="hero-bg" aria-hidden="true">
            <span className="blob blob-a" data-speed="0.18" />
            <span className="blob blob-b" data-speed="0.32" />
            <span className="blob blob-c" data-speed="-0.12" />
          </div>
          <div className="hero-inner">
            <div className="hero-copy" data-speed="0.06">
              <h1 id="hero-title">Chat in real time, with anyone, right from your browser.</h1>
              <p className="lead">{invited ? <>You are invited to <strong>{invited}</strong>. Pick a name to join.</> : 'No account, no install. Pick a name, join the public lobby or open a private room with a password.'}</p>
              <ul className="hero-points">
                <li><Icon name="check" size={16} /> Messages go {MODE === 'p2p' ? 'straight between browsers' : 'through your own server'}</li>
                <li><Icon name="check" size={16} /> Typing, presence and read receipts</li>
                <li><Icon name="check" size={16} /> Threads, reactions, voice notes, files</li>
              </ul>
            </div>
            <form className="join-card" onSubmit={submit} noValidate aria-label="Join a room">
              <div className="field">
                <label htmlFor="username">Your name</label>
                <div className="name-row">
                  <Avatar name={name || '?'} color={color} size={44} />
                  <input id="username" value={name} maxLength={24} autoComplete="nickname" placeholder="e.g. alex_dev" aria-invalid={Boolean(errors.name)} aria-describedby="username-help"
                    onChange={(e) => { setName(e.target.value); setErrors({}); }} />
                </div>
                <p id="username-help" className={errors.name ? 'field-error' : 'hint'} role={errors.name ? 'alert' : undefined}>{errors.name || 'Letters, numbers, dots, dashes and underscores.'}</p>
              </div>
              <fieldset className="swatches">
                <legend>Avatar colour</legend>
                {COLORS.map((hue) => (
                  <button key={hue} type="button" className={`swatch${color === hue ? ' on' : ''}`} style={{ background: `hsl(${hue} 55% 34%)` }} aria-label={`Colour ${hue}`} aria-pressed={color === hue} onClick={() => setColor(hue)} />
                ))}
              </fieldset>

              {!invited && (
                <div className="seg" role="tablist" aria-label="Where to chat">
                  <button type="button" role="tab" aria-selected={mode === 'lobby'} className={mode === 'lobby' ? 'on' : ''} onClick={() => setMode('lobby')}>Public lobby</button>
                  <button type="button" role="tab" aria-selected={mode === 'room'} className={mode === 'room' ? 'on' : ''} onClick={() => setMode('room')}>Join or create a room</button>
                </div>
              )}

              {mode === 'room' && (
                <>
                  <div className="field">
                    <label htmlFor="room">Room name</label>
                    <input id="room" value={room} maxLength={30} autoComplete="off" readOnly={Boolean(invited)} placeholder="e.g. book-club" aria-invalid={Boolean(errors.room)} aria-describedby="room-help"
                      onChange={(e) => { setRoom(e.target.value); setErrors({}); }} />
                    <p id="room-help" className={errors.room ? 'field-error' : 'hint'} role={errors.room ? 'alert' : undefined}>{errors.room || 'A new name creates the room. Anyone who knows the name can find it.'}</p>
                  </div>
                  <div className="field">
                    <label htmlFor="room-pw">Password <span className="muted">(optional, makes the room private)</span></label>
                    <input id="room-pw" type="password" value={password} maxLength={64} autoComplete="off" aria-invalid={Boolean(errors.password)} aria-describedby="pw-help"
                      onChange={(e) => { setPassword(e.target.value); setErrors({}); }} />
                    <p id="pw-help" className={errors.password ? 'field-error' : 'hint'} role={errors.password ? 'alert' : undefined}>{errors.password || (MODE === 'p2p' ? 'The password also encrypts how browsers find each other, so outsiders cannot even see the room.' : 'Stored as a salted hash on the server.')}</p>
                  </div>
                </>
              )}

              <button type="submit" className="btn btn-primary btn-lg">{mode === 'lobby' ? 'Enter the lobby' : invited ? 'Join this room' : 'Join room'}</button>
              {mode === 'lobby' && <p className="hint notice-inline"><Icon name="shield" size={14} /> {PUBLIC_NOTICE}</p>}
            </form>
          </div>
        </ParallaxScene>

        {(recentRooms().length > 0 || active.length > 0) && (
          <section className="recent" aria-labelledby="recent-title">
            <h2 id="recent-title">{active.length ? 'Active rooms' : 'Your recent rooms'}</h2>
            <ul className="chips-row">
              {(active.length ? active.map((r) => ({ name: r.name, meta: `${r.online} online` })) : recentRooms().map((r) => ({ name: r.name, private: r.private }))).map((r) => (
                <li key={r.name}>
                  <button type="button" className="chip chip-lg" onClick={() => { setMode(r.name === LOBBY ? 'lobby' : 'room'); setRoom(r.name === LOBBY ? '' : r.name); }}>
                    <Icon name={r.private ? 'lock' : 'hash'} size={14} /> {r.name}{r.meta && <small> {r.meta}</small>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ParallaxScene as="section" className="features" aria-labelledby="features-title">
          <div className="features-bg" aria-hidden="true">
            <span className="ring ring-a" data-speed="0.15" />
            <span className="ring ring-b" data-speed="-0.1" />
          </div>
          <Reveal as="h2" id="features-title">Everything a modern chat needs</Reveal>
          <ul className="feature-grid">
            {FEATURES.map((f, i) => (
              <Reveal as="li" key={f.title} delay={i * 60} className="feature">
                <span className="feature-icon"><Icon name={f.icon} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </Reveal>
            ))}
          </ul>
        </ParallaxScene>
      </main>
      <footer className="landing-foot"><p>Chat Room {MODE === 'p2p' ? '- peer-to-peer live preview' : ''}. Public rooms are visible to anyone on the internet.</p></footer>
    </div>
  );
}
