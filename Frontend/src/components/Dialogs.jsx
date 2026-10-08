import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { ACCENTS } from '../hooks/useTheme.js';
import { LIMITS } from '../core/constants.js';
import { avatarColor } from '../lib/format.js';
import { validateName, validateChannelName } from '../lib/validate.js';

const PRESENCE_LABEL = { online: 'Online', idle: 'Idle', away: 'Away', offline: 'Offline' };

// ---------- someone else's card ----------
export function UserDialog({ person, engine, onClose, onMessage, toast }) {
  const blocked = engine.isBlocked(person.uid);
  const muted = engine.isMuted(person.uid);
  const bot = person.uid.startsWith('b0b0b0b0');
  return (
    <Dialog title={person.name} onClose={onClose}>
      <div className="user-card">
        <Avatar name={person.name} color={person.color} size={64} presence={person.presence} />
        <p><strong>{PRESENCE_LABEL[person.presence] || 'Offline'}</strong></p>
        {person.status && <p className="muted">&ldquo;{person.status}&rdquo;</p>}
        {bot && <p className="muted">A local helper that only exists on your device.</p>}
      </div>
      <div className="stack">
        {!bot && <button type="button" className="btn btn-primary" onClick={() => onMessage(person.uid)}><Icon name="chat" size={16} /> Send a direct message</button>}
        {!bot && (
          <button type="button" className="btn" onClick={() => { engine.mute(person.uid, !muted); toast(muted ? `${person.name} unmuted.` : `${person.name} muted. Their messages are collapsed and silent.`); onClose(); }}>
            <Icon name={muted ? 'bell' : 'bellOff'} size={16} /> {muted ? 'Unmute' : 'Mute'} {person.name}
          </button>
        )}
        {!bot && (
          <button type="button" className={`btn ${blocked ? '' : 'btn-danger-quiet'}`} onClick={() => { engine.block(person.uid, !blocked); toast(blocked ? `${person.name} unblocked.` : `${person.name} blocked. Nothing from them will reach you.`); onClose(); }}>
            <Icon name="ban" size={16} /> {blocked ? 'Unblock' : 'Block'} {person.name}
          </button>
        )}
      </div>
      <p className="hint">Muting and blocking only affect what you see. Nobody is told.</p>
    </Dialog>
  );
}

// ---------- Ctrl+K quick switcher ----------
export function QuickSwitcher({ snap, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const options = useMemo(() => {
    const items = [
      ...snap.channels.filter((c) => c.type === 'channel').map((c) => ({ id: c.key, label: c.name, kind: 'Channel', icon: 'hash', unread: c.unread, run: { type: 'chat', key: c.key } })),
      ...snap.channels.filter((c) => c.type !== 'channel').map((c) => ({ id: c.key, label: c.name, kind: c.type === 'dm' ? 'Direct message' : 'Group', icon: c.type === 'dm' ? 'chat' : 'users', unread: c.unread, run: { type: 'chat', key: c.key } })),
      ...snap.people.filter((p) => !snap.channels.some((c) => c.uid === p.uid)).map((p) => ({ id: `p-${p.uid}`, label: p.name, kind: 'Person', icon: 'users', run: { type: 'person', uid: p.uid } })),
    ];
    const needle = q.trim().toLowerCase();
    return needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items;
  }, [snap, q]);
  const list = useRef(null);
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && options[at]) { e.preventDefault(); onPick(options[at].run); }
  };
  return (
    <Dialog title="Jump to" onClose={onClose} initialFocus="input">
      <input type="search" className="wide-input" value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} onKeyDown={onKey}
        placeholder="Channel, person or group" aria-label="Search channels and people" role="combobox" aria-expanded="true" aria-controls="switcher-list" aria-activedescendant={options[at] ? `sw-${options[at].id}` : undefined} />
      <ul className="switcher-list" id="switcher-list" role="listbox" aria-label="Results" ref={list}>
        {options.map((o, i) => (
          <li key={o.id} id={`sw-${o.id}`} role="option" aria-selected={i === at} className={i === at ? 'on' : ''}>
            <button type="button" tabIndex={-1} onClick={() => onPick(o.run)} onMouseMove={() => setAt(i)}>
              <Icon name={o.icon} size={16} /><span className="grow">{o.label}</span>
              {o.unread > 0 && <span className="badge">{o.unread}</span>}<small className="muted">{o.kind}</small>
            </button>
          </li>
        ))}
        {!options.length && <li className="muted pad">Nothing matches.</li>}
      </ul>
    </Dialog>
  );
}

// ---------- create channel / group ----------
export function CreateDialog({ initial = 'channel', snap, engine, onClose, onCreated, toast }) {
  const [tab, setTab] = useState(initial);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  const others = snap.people.filter((p) => p.online && !p.blocked && !p.uid.startsWith('b0b0b0b0'));

  const submit = (e) => {
    e.preventDefault();
    if (tab === 'channel') {
      const problem = validateChannelName(name);
      if (problem) { setError(problem); return; }
      const r = engine.createChannel(name);
      if (r.error) { setError(r.error); return; }
      toast(`#${r.key} created.`);
      onCreated(r.key);
    } else {
      const r = engine.createGroup(name, picked);
      if (r.error) { setError(r.error); return; }
      toast('Group created.');
      onCreated(r.key);
    }
  };
  const toggle = (uid) => setPicked((list) => (list.includes(uid) ? list.filter((u) => u !== uid) : [...list, uid]));
  return (
    <Dialog title="Create" onClose={onClose} initialFocus="input[type=text]">
      <div className="seg" role="tablist" aria-label="What to create">
        <button type="button" role="tab" aria-selected={tab === 'channel'} className={tab === 'channel' ? 'on' : ''} onClick={() => { setTab('channel'); setError(''); }}>Channel</button>
        <button type="button" role="tab" aria-selected={tab === 'group'} className={tab === 'group' ? 'on' : ''} onClick={() => { setTab('group'); setError(''); }}>Group chat</button>
      </div>
      <form onSubmit={submit} noValidate className="stack">
        <div className="field">
          <label htmlFor="create-name">{tab === 'channel' ? 'Channel name' : 'Group name'}</label>
          <input id="create-name" type="text" value={name} maxLength={tab === 'channel' ? LIMITS.channel : LIMITS.groupName} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby="create-error"
            placeholder={tab === 'channel' ? 'e.g. project-ideas' : 'e.g. Weekend plans'} onChange={(e) => { setName(e.target.value); setError(''); }} />
          <p id="create-error" className="field-error" role={error ? 'alert' : undefined}>{error}</p>
        </div>
        {tab === 'group' && (
          <fieldset className="people-pick">
            <legend>People ({picked.length} selected, up to {LIMITS.groupMembers - 1})</legend>
            {others.map((p) => (
              <label key={p.uid} className="check-row"><input type="checkbox" checked={picked.includes(p.uid)} onChange={() => toggle(p.uid)} disabled={!picked.includes(p.uid) && picked.length >= LIMITS.groupMembers - 1} /> <Avatar name={p.name} color={p.color} size={22} /> {p.name}</label>
            ))}
            {!others.length && <p className="muted">Nobody else is online right now. Group chats need at least two other people.</p>}
          </fieldset>
        )}
        <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary">Create</button></div>
      </form>
    </Dialog>
  );
}

// ---------- invite link ----------
export function InviteDialog({ snap, password, kind, onClose, toast }) {
  const [withPw, setWithPw] = useState(Boolean(password));
  const link = useMemo(() => {
    const base = `${window.location.origin}${window.location.pathname}#/join/${encodeURIComponent(snap.ws.name)}`;
    return withPw && password ? `${base}?k=${encodeURIComponent(password)}` : base;
  }, [snap.ws.name, password, withPw]);
  const copy = () => navigator.clipboard?.writeText(link).then(() => toast('Invite link copied'), () => toast('Could not copy. Select the link and copy it.', 'error'));
  const share = () => navigator.share?.({ title: `Join ${snap.ws.name}`, url: link }).catch(() => {});
  return (
    <Dialog title="Invite people" onClose={onClose}>
      <p>Anyone with this link can join <strong>{snap.ws.name}</strong>{snap.ws.password ? ' (they need the password)' : ''}.</p>
      <div className="copy-row">
        <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-primary" onClick={copy}><Icon name="copy" size={16} /> Copy</button>
        {navigator.share && <button type="button" className="btn" onClick={share}>Share</button>}
      </div>
      {password && (
        <label className="check-row"><input type="checkbox" checked={withPw} onChange={(e) => setWithPw(e.target.checked)} /> Include the password in the link</label>
      )}
      {password && withPw && <p className="hint">The password sits after the # so it is never sent to a web server, but anyone who sees the link can join. Share it privately.</p>}
      {!password && snap.ws.password && <p className="hint">Share the password separately. It was not saved on this device.</p>}
      {kind === 'p2p' && <p className="hint">Chat is peer-to-peer: you and your friends need to be online at the same time to exchange messages.</p>}
    </Dialog>
  );
}

// ---------- settings ----------
export function SettingsDialog({ snap, engine, theme, onClose, onClearData, toast }) {
  const me = snap.me;
  const [name, setName] = useState(me.name);
  const [status, setStatus] = useState(me.status || '');
  const [error, setError] = useState('');
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const blockedPeople = snap.blocked.map((uid) => ({ uid, name: snap.people.find((p) => p.uid === uid)?.name || `user-${uid.slice(0, 4)}` }));

  const saveProfile = (e) => {
    e.preventDefault();
    const problem = validateName(name);
    if (problem) { setError(problem); return; }
    engine.setProfile({ name: name.trim(), status });
    setError('');
    toast('Profile saved.');
  };
  const setNotifications = async (on) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission();
      setPerm(result);
      if (result !== 'granted') { toast('Notifications are blocked in your browser settings.', 'error'); return; }
    }
    engine.setSetting('notifications', on);
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form onSubmit={saveProfile} className="stack" noValidate>
        <h3>Profile</h3>
        <div className="field">
          <label htmlFor="set-name">Display name</label>
          <input id="set-name" value={name} maxLength={LIMITS.name} autoComplete="nickname" aria-invalid={Boolean(error)} onChange={(e) => { setName(e.target.value); setError(''); }} />
          <p className="field-error" role={error ? 'alert' : undefined}>{error}</p>
        </div>
        <div className="field">
          <label htmlFor="set-status">Status</label>
          <input id="set-status" value={status} maxLength={LIMITS.status} placeholder="What are you up to?" onChange={(e) => setStatus(e.target.value)} />
        </div>
        <fieldset className="swatches">
          <legend>Avatar colour</legend>
          {[210, 340, 25, 150, 270, 190, 50, 310, 120, 0].map((hue) => (
            <button key={hue} type="button" className={`swatch${me.color === hue ? ' on' : ''}`} style={{ background: avatarColor(hue) }} aria-label={`Colour ${hue}`} aria-pressed={me.color === hue} onClick={() => engine.setProfile({ color: hue })} />
          ))}
        </fieldset>
        <div><button type="submit" className="btn btn-primary">Save profile</button></div>
      </form>

      <section className="stack">
        <h3>Appearance</h3>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {['system', 'light', 'dark'].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={theme.choice === c} className={theme.choice === c ? 'on' : ''} onClick={() => theme.setChoice(c)}>{c[0].toUpperCase() + c.slice(1)}</button>
          ))}
        </div>
        <fieldset className="swatches">
          <legend>Accent colour</legend>
          {ACCENTS.map((a) => (
            <button key={a.id} type="button" className={`swatch swatch-accent${theme.accent === a.id ? ' on' : ''}`} style={{ background: `hsl(${a.hue} 65% ${a.l}%)` }} aria-label={a.label} aria-pressed={theme.accent === a.id} onClick={() => theme.setAccent(a.id)} />
          ))}
        </fieldset>
      </section>

      <section className="stack">
        <h3>Notifications and safety</h3>
        <label className="check-row"><input type="checkbox" checked={snap.settings.sound} onChange={(e) => engine.setSetting('sound', e.target.checked)} /> Play a sound for mentions and direct messages</label>
        <label className="check-row"><input type="checkbox" checked={snap.settings.notifications && perm === 'granted'} disabled={perm === 'unsupported'} onChange={(e) => setNotifications(e.target.checked)} /> Desktop notifications when this tab is in the background{perm === 'denied' ? ' (blocked by the browser)' : ''}</label>
        <label className="check-row"><input type="checkbox" checked={snap.settings.family} onChange={(e) => engine.setSetting('family', e.target.checked)} /> Family friendly mode: hide common bad words</label>
        {blockedPeople.length > 0 && (
          <div>
            <p><strong>Blocked people</strong></p>
            <ul className="blocked-list">
              {blockedPeople.map((b) => <li key={b.uid}>{b.name} <button type="button" className="link-btn" onClick={() => engine.block(b.uid, false)}>Unblock</button></li>)}
            </ul>
          </div>
        )}
      </section>

      <section className="stack">
        <h3>Keyboard shortcuts</h3>
        <dl className="shortcuts">
          <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Jump to a channel or person</dd>
          <dt><kbd>Enter</kbd></dt><dd>Send</dd>
          <dt><kbd>Shift</kbd> <kbd>Enter</kbd></dt><dd>New line</dd>
          <dt><kbd>Up</kbd></dt><dd>Edit your last message (empty box)</dd>
          <dt><kbd>Esc</kbd></dt><dd>Close panels, cancel reply or edit</dd>
        </dl>
      </section>

      <section className="stack">
        <h3>This device</h3>
        <p className="muted">Your identity: <code>{me.uid}</code></p>
        <button type="button" className="btn btn-danger-quiet" onClick={onClearData}><Icon name="trash" size={16} /> Clear this room&apos;s history on this device</button>
      </section>
    </Dialog>
  );
}
