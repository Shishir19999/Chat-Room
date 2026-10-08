import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import ChatApp from '../ChatApp.jsx';
import Icon from '../components/Icon.jsx';
import { createSession, MODE } from '../app/session.js';
import { KEYS, readJson, readSession, writeSession } from '../lib/storage.js';
import { cleanWorkspace } from '../core/ops.js';

export default function ChatPage({ theme }) {
  const params = useParams();
  const [search] = useSearchParams();
  const ws = cleanWorkspace(params.ws || 'lobby') || 'lobby';
  const profile = readJson(KEYS.profile, null);
  const fromUrl = search.get('k');
  const password = fromUrl || readSession(`chat:pw:${ws}`, '') || '';
  const [state, setState] = useState({ key: '', session: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const key = `${ws}|${password}|${attempt}`;

  useEffect(() => {
    if (!profile?.name) return undefined;
    // The password can come in the invite link; keep it for reloads of this tab only, then tidy the address bar.
    if (fromUrl) {
      writeSession(`chat:pw:${ws}`, fromUrl);
      const clean = `${window.location.pathname}${window.location.search}#/chat/${ws}`;
      window.history.replaceState(null, '', clean);
    }
    let cancelled = false;
    let made = null;
    createSession({ ws, password, profile, isCancelled: () => cancelled })
      .then((session) => {
        if (!session) return;
        if (cancelled) { session.engine.stop(); return; }
        made = session;
        setState({ key, session, error: '' });
      })
      .catch((e) => { if (!cancelled) setState({ key, session: null, error: e?.message || 'Could not start the chat.' }); });
    return () => {
      cancelled = true;
      if (made) { made.practice.stop(); made.engine.stop(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!profile?.name) return <Navigate to={`/join/${ws}`} replace />;
  const leave = () => { window.location.hash = '#/'; };
  if (state.error && state.key === key) {
    return (
      <main className="center-page" id="main">
        <div className="card stack">
          <h1>Could not start the chat</h1>
          <p className="field-error" role="alert">{state.error}</p>
          <div className="dialog-actions"><Link className="btn" to="/">Back</Link><button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>
        </div>
      </main>
    );
  }
  if (!state.session || state.key !== key) {
    return (
      <main className="center-page" id="main" aria-busy="true">
        <div className="card stack" role="status">
          <Icon name="refresh" size={28} className="spin" />
          <h1>Joining {ws}...</h1>
          <p className="muted">{MODE === 'p2p' ? 'Finding other people through public relays. No account or server needed.' : 'Connecting to the server.'}</p>
        </div>
      </main>
    );
  }
  return <ChatApp session={state.session} theme={theme} password={password} onLeave={leave} />;
}
