import Icon from './Icon.jsx';

const QUALITY_TEXT = { good: 'Good connection', fair: 'Fair connection', poor: 'Poor connection' };

export function ConnectionBadge({ status, kind }) {
  const { state, peers, quality, rtt, detail, strategy } = status;
  let label;
  let tone;
  if (state === 'offline') { label = 'Offline'; tone = 'bad'; }
  else if (state === 'connecting') { label = 'Connecting'; tone = 'wait'; }
  else if (kind === 'p2p') { label = peers ? `${peers} ${peers === 1 ? 'peer' : 'peers'}` : 'Waiting for people'; tone = peers ? 'ok' : 'wait'; }
  else { label = 'Online'; tone = 'ok'; }
  const q = quality ? `${QUALITY_TEXT[quality]}${rtt != null ? ` (${rtt} ms)` : ''}` : '';
  const title = [detail, strategy && `Discovery: ${strategy}`, q].filter(Boolean).join(' - ');
  return (
    <span className={`conn conn-${tone}`} role="status" title={title} aria-label={`Connection: ${label}${q ? `. ${q}` : ''}`}>
      <Icon name={state === 'offline' ? 'wifiOff' : 'wifi'} size={14} />
      <span>{label}</span>
      {quality && state === 'online' && <span className={`quality quality-${quality}`} aria-hidden="true"><i /><i /><i /></span>}
    </span>
  );
}

export default function ChatHeader({ conversation, snap, kind, panel, pinCount, onMenu, onPanel, onInvite }) {
  const isDm = conversation?.type === 'dm';
  return (
    <header className="chat-head">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open sidebar"><Icon name="menu" /></button>
      <div className="head-title">
        <h1>{conversation ? (isDm ? conversation.name : conversation.type === 'channel' ? `# ${conversation.name}` : conversation.name) : snap.ws.name}</h1>
        <p className="muted">
          {conversation?.type === 'channel' && (conversation.topic || `Everyone in ${snap.ws.name}`)}
          {isDm && (conversation.online ? 'Online now' : 'Offline. Messages are delivered when they are back.')}
          {conversation?.type === 'group' && `${conversation.members.length} people`}
        </p>
      </div>
      <ConnectionBadge status={snap.status} kind={kind} />
      <div className="head-actions">
        <button type="button" className={`icon-btn${panel === 'pins' ? ' on' : ''}`} onClick={() => onPanel('pins')} aria-label={`Pinned messages (${pinCount})`} aria-pressed={panel === 'pins'}><Icon name="pin" />{pinCount > 0 && <span className="mini-count">{pinCount}</span>}</button>
        <button type="button" className={`icon-btn${panel === 'search' ? ' on' : ''}`} onClick={() => onPanel('search')} aria-label="Search messages" aria-pressed={panel === 'search'}><Icon name="search" /></button>
        <button type="button" className="icon-btn" onClick={onInvite} aria-label="Invite people"><Icon name="userPlus" /></button>
      </div>
    </header>
  );
}
