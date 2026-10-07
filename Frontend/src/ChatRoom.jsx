import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { createClient, IS_DEMO } from './api/index.js';
import { useChat } from './hooks/useChat.js';
import { KEYS, readJson, writeJson } from './lib/storage.js';
import { DEFAULT_ROOM, cleanRoom } from './lib/limits.js';
import Sidebar from './components/Sidebar.jsx';
import ChatHeader from './components/ChatHeader.jsx';
import MessageList from './components/MessageList.jsx';
import Composer from './components/Composer.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import CreateRoomDialog from './components/CreateRoomDialog.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import Dialog from './components/Dialog.jsx';
import DemoBanner from './components/DemoBanner.jsx';
import { useToast } from './components/Toasts.jsx';

// Creates the client (real or demo) once, then renders the chat.
export default function ChatRoom(props) {
  const { room: param } = useParams();
  const [client, setClient] = useState(null);
  const [failed, setFailed] = useState(false);
  const { user } = props;

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    createClient().then((c) => { if (!cancelled) setClient(c); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; setClient(null); };
  }, [user]);

  if (!user) return <Navigate to="/" replace />;
  const room = cleanRoom(param || DEFAULT_ROOM);
  if (param && param !== room) return <Navigate to={`/chat/${room}`} replace />;
  if (failed) {
    return (
      <main className="center-screen"><div className="state" role="alert"><h1>Could not start the chat</h1><p>Reload the page and try again.</p></div></main>
    );
  }
  if (!client) return <main className="center-screen" aria-busy="true"><p className="muted">Loading chat...</p></main>;
  return <ChatView {...props} client={client} room={room} />;
}

function ChatView({ client, room, user, setUser, theme, onToggleTheme }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [soundOn, setSoundOn] = useState(() => readJson(KEYS.sound, false));
  const chat = useChat({ client, user, room, soundOn });
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const composer = useRef(null);

  // Opening a room that does not exist yet creates it.
  const { roomsPhase, rooms, createRoom } = chat;
  const known = rooms.some((r) => r.name === room);
  useEffect(() => {
    if (roomsPhase === 'ready' && !known) createRoom({ name: room, description: '' }).catch(() => {});
  }, [roomsPhase, known, room, createRoom]);

  const [shownRoom, setShownRoom] = useState(room);
  if (shownRoom !== room) {
    setShownRoom(room);
    setReplyTo(null);
    setSearching(false);
    setMenu(false);
  }
  useEffect(() => { document.title = `#${room} - Chat Room`; return () => { document.title = 'Chat Room'; }; }, [room]);

  const toggleSound = () => {
    setSoundOn((v) => { writeJson(KEYS.sound, !v); return !v; });
  };

  const fail = useCallback((e) => toast(e.message || 'Something went wrong.', 'error'), [toast]);
  const actions = {
    loadOlder: () => chat.loadOlder().catch(fail),
    reply: (m) => { setReplyTo(m); composer.current?.focus(); },
    react: (m, emoji) => chat.react(m._id, emoji).catch(fail),
    edit: (m, text) => chat.edit(m._id, text).catch((e) => { fail(e); throw e; }),
    askDelete: setDeleting,
    openImage: setViewing,
  };

  const current = rooms.find((r) => r.name === room);
  const offline = client.mode === 'real' && chat.status !== 'connected';

  return (
    <div className="app-shell">
      {IS_DEMO && <DemoBanner client={client} />}
      <div className="app-body">
        <Sidebar
          open={menu} onClose={() => setMenu(false)} chat={chat} room={room} user={user}
          onLogout={() => { setUser(''); navigate('/'); }}
          onNewRoom={() => { setMenu(false); setCreating(true); }}
          theme={theme} onToggleTheme={onToggleTheme} soundOn={soundOn} onToggleSound={toggleSound}
        />
        <main className="chat" id="main">
          <ChatHeader
            room={room} description={current?.description} status={chat.status} online={chat.online} me={user}
            onMenu={() => setMenu(true)} onSearch={() => setSearching((s) => !s)} searching={searching}
            onMention={(u) => composer.current?.insert(`@${u}`)}
          />
          {searching ? (
            <SearchPanel room={room} me={user} search={chat.search} onClose={() => setSearching(false)} />
          ) : (
            <MessageList chat={chat} room={room} me={user} actions={actions} />
          )}
          <div className="typing" aria-live="polite">
            {chat.typing.length > 0 && (
              <span><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>{chat.typing.join(', ')} {chat.typing.length > 1 ? 'are' : 'is'} typing</span>
            )}
          </div>
          <Composer
            ref={composer} room={room} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
            onSend={(payload) => chat.send(payload)} onTyping={chat.setTyping}
            disabled={offline} offlineHint={offline ? 'You are offline. Messages can be sent again once reconnected.' : ''} onError={fail}
          />
        </main>
      </div>

      {creating && (
        <CreateRoomDialog
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const created = await chat.createRoom(input);
            setCreating(false);
            toast(`Room #${created.name} created.`, 'success');
            navigate(`/chat/${created.name}`);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this message?"
          message="This cannot be undone. Everyone in the room will see it as deleted."
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try { await chat.remove(deleting._id); toast('Message deleted.', 'success'); } catch (e) { fail(e); }
            setDeleting(null);
          }}
        />
      )}
      {viewing && (
        <Dialog title={`Image from ${viewing.user}`} onClose={() => setViewing(null)}>
          <img className="viewer-image" src={viewing.image} alt={`Attachment from ${viewing.user}`} />
        </Dialog>
      )}
    </div>
  );
}
