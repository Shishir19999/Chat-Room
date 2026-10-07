import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import ParallaxScene from '../components/Parallax.jsx';
import Reveal from '../components/Reveal.jsx';
import DemoBanner from '../components/DemoBanner.jsx';
import { IS_DEMO } from '../api/index.js';
import { DEFAULT_ROOM, LIMITS, cleanRoom, validateUsername } from '../lib/limits.js';

const FEATURES = [
  { icon: 'bolt', title: 'Live rooms', text: 'Messages, typing and presence update instantly for everyone in the room.' },
  { icon: 'smile', title: 'Reactions and replies', text: 'React with emoji, reply to a message and keep threads easy to follow.' },
  { icon: 'image', title: 'Share images', text: 'Paste or upload a picture. It is resized to stay small.' },
  { icon: 'search', title: 'Search and history', text: 'Find old messages fast and load older history on demand.' },
  { icon: 'users', title: 'Mentions', text: 'Type @name to get someone\'s attention. Mentions are highlighted.' },
  { icon: 'shield', title: 'Safe by default', text: 'Content is escaped, inputs are validated and uploads are size-limited.' },
];

export default function Landing({ user, setUser, theme, onToggleTheme }) {
  const navigate = useNavigate();
  const [name, setName] = useState(user || '');
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const problem = validateUsername(name);
    if (problem) { setError(problem); return; }
    setUser(name.trim());
    navigate(`/chat/${cleanRoom(room)}`);
  };

  return (
    <div className="landing">
      {IS_DEMO && <DemoBanner />}
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
              <h1 id="hero-title">Talk in real time, in rooms that fit.</h1>
              <p className="lead">Join a room, reply, react and share pictures. No account needed, just pick a name.</p>
            </div>
            <form className="join-card" onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="username">Your name</label>
                <input id="username" value={name} maxLength={LIMITS.user} autoComplete="nickname" placeholder="e.g. alex_dev"
                  aria-invalid={Boolean(error)} aria-describedby="username-help"
                  onChange={(e) => { setName(e.target.value); setError(''); }} />
                <p id="username-help" className={error ? 'field-error' : 'hint'} role={error ? 'alert' : undefined}>{error || 'Letters, numbers, dots, dashes and underscores.'}</p>
              </div>
              <div className="field">
                <label htmlFor="room">Room</label>
                <div className="input-prefix"><span aria-hidden="true">#</span>
                  <input id="room" value={room} maxLength={LIMITS.room} autoComplete="off" onChange={(e) => setRoom(e.target.value)} />
                </div>
                <p className="hint">New names create a room when you join.</p>
              </div>
              <button type="submit" className="btn btn-primary btn-lg">{user && user === name.trim() ? `Continue as ${user}` : 'Join the chat'}</button>
            </form>
          </div>
        </ParallaxScene>

        <ParallaxScene as="section" className="features" aria-labelledby="features-title">
          <div className="features-bg" aria-hidden="true">
            <span className="ring ring-a" data-speed="0.15" />
            <span className="ring ring-b" data-speed="-0.1" />
          </div>
          <Reveal as="h2" id="features-title">Everything a good chat needs</Reveal>
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
      <footer className="landing-foot"><p>Chat Room {IS_DEMO ? '(browser demo)' : ''}</p></footer>
    </div>
  );
}
