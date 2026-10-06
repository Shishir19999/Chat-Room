import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const MAX_USER_LEN = 30;
const MAX_MESSAGE_LEN = 500;
const MAX_ROOM_LEN = 30;
const PAGE_SIZE = 50;

const cleanRoom = (v) => v.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, MAX_ROOM_LEN) || 'general';

// Note: React escapes text rendered as JSX children, so message content is never injected as HTML.
const ChatRoom = () => {
  const [messages, setMessages] = useState([]);
  const [user, setUser] = useState('');
  const [message, setMessage] = useState('');
  const [roomInput, setRoomInput] = useState('general');
  const [room, setRoom] = useState(null); // joined room
  const [status, setStatus] = useState('connecting'); // connecting | connected | reconnecting | disconnected
  const [online, setOnline] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const socketRef = useRef(null);
  const joinRef = useRef(null); // { user, room } to rejoin after reconnect
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const skipScroll = useRef(false); // do not jump to the bottom when older messages are prepended
  const oldestId = useRef(null);

  // Latest page of a room (also used to catch up after a reconnect).
  const loadHistory = useCallback(async (r) => {
    try {
      const res = await fetch(`${API_URL}/messages?room=${encodeURIComponent(r)}&limit=${PAGE_SIZE}`);
      const body = await res.json();
      const data = Array.isArray(body.data) ? body.data : [];
      setMessages(data);
      setHasMore(Boolean(body.hasMore));
      oldestId.current = data.length ? data[0]._id : null;
    } catch (e) {
      console.error('Error fetching messages:', e);
    }
  }, []);

  // Cursor pagination: fetch messages older than the oldest one we hold.
  const loadOlder = async () => {
    if (!room || !oldestId.current || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`${API_URL}/messages?room=${encodeURIComponent(room)}&before=${oldestId.current}&limit=${PAGE_SIZE}`);
      const body = await res.json();
      const older = Array.isArray(body.data) ? body.data : [];
      skipScroll.current = true;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m._id));
        return [...older.filter((m) => !seen.has(m._id)), ...prev];
      });
      setHasMore(Boolean(body.hasMore));
      if (older.length) oldestId.current = older[0]._id;
    } catch (e) {
      console.error('Error fetching older messages:', e);
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    const socket = io(API_URL, { reconnectionDelayMax: 5000 });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      if (joinRef.current) {
        socket.emit('join', joinRef.current);
        loadHistory(joinRef.current.room); // catch up on anything missed while offline
      }
    });
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.on('connect_error', () => setStatus('reconnecting'));

    socket.on('message', (msg) => {
      setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
    });
    socket.on('presence', ({ users }) => setOnline(users));
    socket.on('typing', ({ user: who, typing }) => {
      setTypingUsers((prev) => {
        const without = prev.filter((u) => u !== who);
        return typing ? [...without, who] : without;
      });
    });
    socket.on('error_message', (m) => setError(m));

    return () => {
      socket.disconnect();
    };
  }, [loadHistory]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (skipScroll.current) {
      skipScroll.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const join = async (e) => {
    e.preventDefault();
    const name = user.trim().slice(0, MAX_USER_LEN);
    if (!name) {
      setError('Please enter a name');
      return;
    }
    const r = cleanRoom(roomInput);
    setError('');
    setTypingUsers([]);
    joinRef.current = { user: name, room: r };
    setUser(name);
    // Join first and only show the room once history is loaded, so a message can't be sent before the server knows our room.
    socketRef.current.emit('join', joinRef.current);
    await loadHistory(r);
    setRoom(r);
  };

  const leave = () => {
    socketRef.current.emit('leave');
    joinRef.current = null;
    setRoom(null);
    setMessages([]);
    setHasMore(false);
    oldestId.current = null;
    setOnline([]);
    setTypingUsers([]);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    if (status !== 'connected') {
      setError('Not connected. Please wait for reconnection.');
      return;
    }
    socketRef.current.emit('message', { message: text.slice(0, MAX_MESSAGE_LEN) }, (res) => {
      if (res && !res.ok) setError(res.error);
    });
    socketRef.current.emit('typing', false);
    clearTimeout(typingTimer.current);
    setError('');
    setMessage('');
  };

  const onMessageChange = (e) => {
    setMessage(e.target.value);
    const s = socketRef.current;
    if (!s || !room) return;
    s.emit('typing', true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => s.emit('typing', false), 1500);
  };

  const statusLabel = {
    connecting: 'Connecting...',
    connected: 'Connected',
    reconnecting: 'Reconnecting...',
    disconnected: 'Disconnected',
  }[status];
  const statusColor = status === 'connected' ? '#1a9e4a' : status === 'disconnected' ? '#c0392b' : '#d68910';

  return (
    <div className="chat">
      <h2>Chat Room</h2>
      <p className="status">
        <span className="dot" style={{ background: statusColor }} /> {statusLabel}
      </p>
      {error && <p className="error">{error}</p>}

      {!room ? (
        <form onSubmit={join} className="join">
          <input type="text" placeholder="Your name" maxLength={MAX_USER_LEN} value={user} onChange={(e) => setUser(e.target.value)} />
          <input type="text" placeholder="Room (default: general)" maxLength={MAX_ROOM_LEN} value={roomInput} onChange={(e) => setRoomInput(e.target.value)} />
          <button type="submit">Join</button>
        </form>
      ) : (
        <>
          <p>
            Room <strong>#{room}</strong> as <strong>{user}</strong> <button onClick={leave}>Leave</button>
          </p>
          <p className="online">Online ({online.length}): {online.join(', ')}</p>
          <ul className="messages">
            {hasMore && (
              <li className="older">
                <button type="button" data-testid="load-older" onClick={loadOlder} disabled={loadingOlder}>
                  {loadingOlder ? 'Loading...' : 'Load older messages'}
                </button>
              </li>
            )}
            {messages.map((m) => (
              <li key={m._id}>
                <strong>{m.user}:</strong> {m.message}
              </li>
            ))}
            <div ref={bottomRef} />
          </ul>
          <p className="typing">
            {typingUsers.length > 0 ? `${typingUsers.join(', ')} ${typingUsers.length > 1 ? 'are' : 'is'} typing...` : ' '}
          </p>
          <form onSubmit={sendMessage}>
            <input
              type="text"
              placeholder="Type your message..."
              maxLength={MAX_MESSAGE_LEN}
              value={message}
              onChange={onMessageChange}
            />
            <button type="submit" disabled={status !== 'connected'}>Send</button>
          </form>
        </>
      )}
    </div>
  );
};

export default ChatRoom;
