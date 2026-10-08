import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatProvider, useSnapshot } from './app/ChatContext.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatHeader from './components/ChatHeader.jsx';
import MessageList from './components/MessageList.jsx';
import Composer from './components/Composer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { DemoBanner, StatusBanners } from './components/Banners.jsx';
import { PinsPanel, SearchPanel, ThreadPanel } from './components/Panels.jsx';
import { CreateDialog, InviteDialog, QuickSwitcher, SettingsDialog, UserDialog } from './components/Dialogs.jsx';
import { useToast } from './components/Toasts.jsx';
import { DEFAULT_CHANNEL } from './core/constants.js';
import { KEYS, readJson, writeJson } from './lib/storage.js';
import { MODE } from './app/session.js';

// The chat screen. All logic lives in the engine; this component wires it to the UI.
export default function ChatApp({ session, theme, password, onLeave }) {
  const { engine, practice } = session;
  const snap = useSnapshot(engine);
  const { toast } = useToast();
  const [selected, setActive] = useState(DEFAULT_CHANNEL);
  const [sidebar, setSidebar] = useState(false);
  const [panel, setPanel] = useState(null); // { type: 'thread' | 'pins' | 'search', root? }
  const [dialog, setDialog] = useState(null);
  const [reply, setReply] = useState(null);
  const [editing, setEditing] = useState(null);
  const [incomingFile, setIncomingFile] = useState(null);
  const [noticeHidden, setNoticeHidden] = useState(() => readJson(KEYS.tip, []).includes('public-notice'));
  const jump = useRef(null);
  const pendingJump = useRef(null);
  const fileCount = useRef(0);

  // Fall back to the default channel if the selected conversation disappears (for example a removed group).
  const active = snap.channels.some((c) => c.key === selected) ? selected : DEFAULT_CHANNEL;
  const conversation = snap.channels.find((c) => c.key === active) || null;
  const messages = engine.view(active);
  const isPublic = !snap.ws.password && conversation?.type !== 'dm' && conversation?.type !== 'group';

  // Keep a valid conversation selected and tell the engine which one is open.
  useEffect(() => { engine.setActive(active); }, [engine, active]);

  useEffect(() => {
    document.title = `${snap.unreadTotal ? `(${snap.unreadTotal}) ` : ''}${snap.ws.name} - Chat Room`;
  }, [snap.unreadTotal, snap.ws.name]);

  // Visibility and activity feed read receipts and the idle/away presence state.
  useEffect(() => {
    const vis = () => engine.setVisible(document.visibilityState === 'visible');
    const act = () => engine.activity();
    vis();
    document.addEventListener('visibilitychange', vis);
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, act, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', vis);
      for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, act);
    };
  }, [engine]);

  useEffect(() => engine.on('notice', (n) => toast(n.text, n.kind)), [engine, toast]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setDialog({ type: 'switcher' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const select = useCallback((key) => { setActive(key); setSidebar(false); setReply(null); setEditing(null); setPanel((p) => (p?.type === 'thread' ? null : p)); }, []);
  const openUser = useCallback((uid) => setDialog({ type: 'user', uid }), []);

  useEffect(() => {
    if (pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      requestAnimationFrame(() => requestAnimationFrame(() => jump.current?.(id)));
    }
  }, [active]);
  const showMessage = (m) => {
    pendingJump.current = m.id;
    if (m.c !== active) select(m.c); else { pendingJump.current = null; jump.current?.(m.id); }
    if (m.c === active) setPanel(null);
  };

  const ctx = useMemo(() => ({
    engine, me: snap.me.name, family: snap.settings.family, toast,
    registerJump: (fn) => { jump.current = fn; },
    onJump: (id) => jump.current?.(id),
    onReply: (m) => { setEditing(null); setReply({ id: m.id, name: m.name, text: (m.text || (m.att ? m.att.name : 'Sticker')).slice(0, 80) }); },
    onThread: (m) => setPanel({ type: 'thread', root: m.root || m.id }),
    onEdit: (m) => { setReply(null); setEditing({ id: m.id, text: m.text }); },
    onUser: openUser,
    onConfirmDelete: (m) => setDialog({ type: 'delete', m }),
  }), [engine, snap.me.name, snap.settings.family, toast, openUser]);

  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.mine && !m.deleted && !m.att && !m.stk);
    if (mine) ctx.onEdit(mine);
  };

  const togglePanel = (type) => setPanel((p) => (p?.type === type ? null : { type }));
  const hideNotice = () => {
    setNoticeHidden(true);
    writeJson(KEYS.tip, [...readJson(KEYS.tip, []), 'public-notice']);
  };

  const onDrop = (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    setIncomingFile({ file: f, n: ++fileCount.current });
  };

  const typing = (snap.typing[active] || []).filter((n) => n !== snap.me.name);
  const typingText = typing.length === 0 ? '' : typing.length === 1 ? `${typing[0]} is typing` : typing.length === 2 ? `${typing[0]} and ${typing[1]} are typing` : 'Several people are typing';
  const person = dialog?.type === 'user' ? snap.people.find((p) => p.uid === dialog.uid) || { uid: dialog.uid, name: engine.getSnapshot().people.find((p) => p.uid === dialog.uid)?.name || 'Someone', color: 210, presence: 'offline' } : null;
  const placeholder = conversation ? `Message ${conversation.type === 'channel' ? `#${conversation.name}` : conversation.name}` : 'Message';

  return (
    <ChatProvider value={ctx}>
      <div className="app">
        {MODE === 'p2p' && <DemoBanner />}
        <div className={`shell${panel ? ' has-panel' : ''}`}>
          <Sidebar snap={snap} active={active} open={sidebar} onClose={() => setSidebar(false)} onSelect={select}
            onSwitcher={() => setDialog({ type: 'switcher' })} onCreate={(tab) => setDialog({ type: 'create', tab })}
            onInvite={() => setDialog({ type: 'invite' })} onSettings={() => setDialog({ type: 'settings' })} onUser={openUser} onLeave={onLeave} />
          {sidebar && <button type="button" className="scrim" aria-label="Close sidebar" onClick={() => setSidebar(false)} />}

          <main className="main" id="main" onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
            <ChatHeader conversation={conversation} snap={snap} kind={engine.kind} panel={panel?.type} pinCount={engine.pins(active).length}
              onMenu={() => setSidebar(true)} onPanel={togglePanel} onInvite={() => setDialog({ type: 'invite' })} />
            <StatusBanners snap={snap} kind={engine.kind} isPublic={isPublic} practiceActive={snap.settings.practice}
              onPractice={(on) => (on ? practice.start(active) : practice.stop())} onInvite={() => setDialog({ type: 'invite' })}
              onReconnect={session.transport.reconnect ? () => session.transport.reconnect() : undefined}
              noticeHidden={noticeHidden} onHideNotice={hideNotice} />
            <MessageList channel={active} messages={messages} engine={engine} ctx={ctx} anchor={engine.anchorFor(active)}
              empty={(
                <div className="empty">
                  <h2>{conversation?.type === 'dm' ? `Your conversation with ${conversation.name}` : `Welcome to ${conversation?.type === 'channel' ? `#${conversation.name}` : conversation?.name || 'the room'}`}</h2>
                  <p className="muted">{conversation?.type === 'dm' ? 'Only the two of you can read this.' : 'This is the start of the conversation. Say hello!'}</p>
                </div>
              )} />
            <div className="typing" aria-live="polite" aria-atomic="true">
              {typingText && <><span className="dots" aria-hidden="true"><i /><i /><i /></span> {typingText}...</>}
            </div>
            <Composer key={`${active}:${editing?.id || ''}`} channel={active} engine={engine} people={snap.people} reply={reply} editing={editing}
              onCancelReply={() => setReply(null)} onCancelEdit={() => setEditing(null)} onEditLast={editLast} toast={toast}
              incomingFile={incomingFile} placeholder={placeholder} />
          </main>

          {panel?.type === 'thread' && <ThreadPanel engine={engine} channel={active} rootId={panel.root} ctx={ctx} onClose={() => setPanel(null)} toast={toast} />}
          {panel?.type === 'pins' && <PinsPanel engine={engine} channel={active} ctx={ctx} onClose={() => setPanel(null)} onJump={showMessage} />}
          {panel?.type === 'search' && <SearchPanel engine={engine} channel={active} ctx={ctx} onClose={() => setPanel(null)} onOpen={showMessage} />}
        </div>

        <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="announcer">{snap.announce.text}</div>

        {dialog?.type === 'switcher' && (
          <QuickSwitcher snap={snap} onClose={() => setDialog(null)}
            onPick={(run) => { setDialog(null); if (run.type === 'chat') select(run.key); else openUser(run.uid); }} />
        )}
        {dialog?.type === 'create' && (
          <CreateDialog initial={dialog.tab} snap={snap} engine={engine} toast={toast} onClose={() => setDialog(null)} onCreated={(key) => { setDialog(null); select(key); }} />
        )}
        {dialog?.type === 'invite' && <InviteDialog snap={snap} password={password} kind={engine.kind} toast={toast} onClose={() => setDialog(null)} />}
        {dialog?.type === 'settings' && (
          <SettingsDialog snap={snap} engine={engine} theme={theme} toast={toast} onClose={() => setDialog(null)}
            onClearData={() => setDialog({ type: 'clear' })} />
        )}
        {dialog?.type === 'user' && person && (
          <UserDialog person={person} engine={engine} toast={toast} onClose={() => setDialog(null)}
            onMessage={(uid) => { const r = engine.openDm(uid); setDialog(null); if (r.key) select(r.key); }} />
        )}
        {dialog?.type === 'delete' && (
          <ConfirmDialog title="Delete message?" message="It will disappear for everyone. A note will show that a message was deleted." confirmLabel="Delete"
            onCancel={() => setDialog(null)} onConfirm={() => { const r = engine.remove(dialog.m.id, dialog.m.c); if (r.error) toast(r.error, 'error'); setDialog(null); }} />
        )}
        {dialog?.type === 'clear' && (
          <ConfirmDialog title="Clear history on this device?" confirmLabel="Clear history"
            message="Messages saved in this browser for this room are removed. Other people keep their copies and may send them again when you reconnect."
            onCancel={() => setDialog(null)} onConfirm={async () => { await engine.clearHistory(); window.location.reload(); }} />
        )}
      </div>
    </ChatProvider>
  );
}
