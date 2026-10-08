import { memo, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import Menu from './Menu.jsx';
import RichText from './RichText.jsx';
import Attachment from './Attachment.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { QUICK_REACTIONS } from '../core/emoji.js';
import { isJumbo } from '../core/sanitize.js';
import { formatTime } from '../lib/format.js';

function Receipt({ receipt }) {
  if (!receipt) return null;
  if (receipt.seen > 0) {
    return <span className="receipt seen" title={`Seen by ${receipt.seenBy.join(', ')}`}><Icon name="checks" size={14} /> Seen by {receipt.seen}</span>;
  }
  if (receipt.delivered > 0) return <span className="receipt" title={`Delivered to ${receipt.delivered}`}><Icon name="checks" size={14} /> Delivered</span>;
  return <span className="receipt" title="Saved on this device. It reaches people when they are connected."><Icon name={receipt.peers ? 'check' : 'clock'} size={14} /> {receipt.peers ? 'Sent' : 'Waiting for people'}</span>;
}

function MessageBase({ item, ctx, highlight = '', readOnly = false, compact = false }) {
  const { message: m, grouped } = item;
  const { engine, me, family, onReply, onThread, onEdit, onJump, onUser, onConfirmDelete, toast } = ctx;
  const [picker, setPicker] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const jumbo = !m.deleted && !m.att && !m.stk && isJumbo(m.text);

  const react = (emoji) => { const r = engine.react(m.id, m.c, emoji); if (r.error) toast(r.error, 'error'); };
  const copy = () => navigator.clipboard?.writeText(m.text).then(() => toast('Message copied'), () => toast('Could not copy', 'error'));

  if (m.muted && !revealed && !m.mine) {
    return (
      <article className="msg msg-muted" id={`m-${m.id}`}>
        <span className="muted">Message from {m.name} (muted). </span>
        <button type="button" className="link-btn" onClick={() => setRevealed(true)}>Show</button>
      </article>
    );
  }

  const menuItems = readOnly ? [] : [
    m.mine && !m.deleted && !m.att && !m.stk && { label: 'Edit', icon: 'edit', onSelect: () => onEdit(m) },
    !m.deleted && { label: m.pinned ? 'Unpin' : 'Pin message', icon: 'pin', onSelect: () => { const r = engine.pin(m.id, m.c, !m.pinned); if (r.error) toast(r.error, 'error'); } },
    !m.deleted && m.text && { label: 'Copy text', icon: 'copy', onSelect: copy },
    !m.mine && !m.deleted && { label: 'Report and hide', icon: 'flag', onSelect: () => { engine.reportMessage(m.id, m.c); toast('Message hidden on this device.'); } },
    !m.mine && { label: `Mute ${m.name}`, icon: 'bellOff', onSelect: () => { engine.mute(m.a, true); toast(`${m.name} muted. Their messages are collapsed.`); } },
    !m.mine && { label: `Block ${m.name}`, icon: 'ban', danger: true, onSelect: () => { engine.block(m.a, true); toast(`${m.name} blocked. You will not see their messages.`); } },
    m.mine && !m.deleted && { label: 'Delete', icon: 'trash', danger: true, onSelect: () => onConfirmDelete(m) },
  ];

  const label = `${m.name}, ${formatTime(m.ts)}${m.deleted ? ', deleted message' : ''}`;
  return (
    <article className={`msg${grouped ? ' msg-grouped' : ''}${m.mine ? ' msg-mine' : ''}${m.mentionsMe ? ' msg-mention' : ''}${m.pinned ? ' msg-pinned' : ''}${compact ? ' msg-compact' : ''}`} id={`m-${m.id}`} data-id={m.id} aria-label={label} tabIndex={-1}>
      <div className="msg-side">
        {grouped ? <time className="msg-hover-time" dateTime={new Date(m.ts).toISOString()}>{formatTime(m.ts)}</time> : (
          <button type="button" className="avatar-btn" onClick={() => onUser?.(m.a)} aria-label={`Open ${m.name}`} disabled={m.mine || !onUser}>
            <Avatar name={m.name} color={m.color} />
          </button>
        )}
      </div>
      <div className="msg-main">
        {!grouped && (
          <header className="msg-head">
            <strong className="msg-author">{m.name}{m.mine && <span className="you"> (you)</span>}</strong>
            <time dateTime={new Date(m.ts).toISOString()}>{formatTime(m.ts)}</time>
            {m.pinned && <span className="tag"><Icon name="pin" size={12} /> Pinned</span>}
            {m.edited && <span className="muted edited" title={new Date(m.editedAt).toLocaleString()}>(edited)</span>}
          </header>
        )}
        {m.reply && (
          <button type="button" className="quote" onClick={() => !m.reply.missing && onJump?.(m.reply.id)} disabled={m.reply.missing || !onJump}>
            <Icon name="reply" size={13} /> <strong>{m.reply.name || 'Someone'}</strong> <span>{m.reply.text}</span>
          </button>
        )}
        {m.deleted ? (
          <p className="msg-deleted"><Icon name="trash" size={14} /> This message was deleted</p>
        ) : (
          <>
            {m.stk && <p className="sticker-msg" role="img" aria-label="Sticker">{m.stk}</p>}
            {m.text && <RichText text={m.text} me={me} highlight={highlight} filter={family} className={jumbo ? 'jumbo' : ''} />}
            {m.att && <Attachment att={m.att} authorUid={m.a} mine={m.mine} engine={engine} />}
          </>
        )}
        {m.reactions.length > 0 && (
          <div className="reactions" role="group" aria-label="Reactions">
            {m.reactions.map((r) => (
              <button key={r.emoji} type="button" className={`chip${r.mine ? ' on' : ''}`} aria-pressed={r.mine} disabled={readOnly}
                aria-label={`${r.emoji} ${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}${r.mine ? ', including yours' : ''}`}
                title={r.users.map((u) => (u === engine.me.uid ? 'You' : engine.getSnapshot().people.find((p) => p.uid === u)?.name || 'Someone')).join(', ')}
                onClick={() => react(r.emoji)}>
                <span aria-hidden="true">{r.emoji}</span> {r.count}
              </button>
            ))}
          </div>
        )}
        {!readOnly && m.threadCount > 0 && (
          <button type="button" className="thread-link" onClick={() => onThread(m)}><Icon name="thread" size={14} /> {m.threadCount} {m.threadCount === 1 ? 'reply' : 'replies'}</button>
        )}
        {m.mine && !m.deleted && !readOnly && <Receipt receipt={m.receipt} />}
      </div>
      {!readOnly && !m.deleted && (
        <div className="msg-tools" role="toolbar" aria-label="Message actions">
          {QUICK_REACTIONS.slice(0, 3).map((e) => <button key={e} type="button" className="icon-btn emoji-btn" aria-label={`React ${e}`} onClick={() => react(e)}>{e}</button>)}
          <span className="menu">
            <button type="button" className="icon-btn" data-picker-trigger aria-label="Add reaction" aria-expanded={picker} onClick={() => setPicker((p) => !p)}><Icon name="smile" size={18} /></button>
            {picker && <EmojiPicker label="Pick a reaction" anchor="side" onClose={() => setPicker(false)} onPick={(e) => { setPicker(false); react(e); }} />}
          </span>
          <button type="button" className="icon-btn" aria-label="Reply" onClick={() => onReply(m)}><Icon name="reply" size={18} /></button>
          {!m.reply && <button type="button" className="icon-btn" aria-label="Open thread" onClick={() => onThread(m)}><Icon name="thread" size={18} /></button>}
          <Menu label="More actions" items={menuItems} />
        </div>
      )}
    </article>
  );
}

export default memo(MessageBase, (a, b) => a.item.message === b.item.message && a.item.grouped === b.item.grouped && a.highlight === b.highlight && a.ctx === b.ctx && a.readOnly === b.readOnly);
