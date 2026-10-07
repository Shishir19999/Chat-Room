import { memo, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import RichText from './RichText.jsx';
import { formatTime, mentionsUser } from '../lib/text.js';
import { LIMITS } from '../lib/limits.js';

function Message({ message: m, grouped, me, onReply, onReact, onEdit, onDelete, onOpenImage }) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(false);
  const own = m.user === me;
  const mentioned = !own && !m.deleted && mentionsUser(m.message, me);

  const startEdit = () => { setDraft(m.message); setEditing(true); };
  const save = async () => {
    const text = draft.trim();
    if (!text && !m.image) return;
    if (text === m.message) { setEditing(false); return; }
    setSaving(true);
    try { await onEdit(m, text); setEditing(false); } finally { setSaving(false); }
  };

  const pick = (emoji) => { setPicker(false); onReact(m, emoji); };

  return (
    <li
      className={`msg${own ? ' own' : ''}${grouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}${active ? ' active' : ''}${m.deleted ? ' is-deleted' : ''}`}
      data-id={m._id}
      tabIndex={0}
      aria-label={`${m.user} at ${formatTime(m.createdAt)}${m.deleted ? ', deleted message' : `: ${m.message || 'image'}`}`}
      onClick={(e) => { if (!e.target.closest('button,a,textarea,img')) setActive((a) => !a); }}
    >
      <div className="msg-gutter">
        {grouped ? <span className="msg-time-hover">{formatTime(m.createdAt)}</span> : <Avatar name={m.user} />}
      </div>
      <div className="msg-main">
        {!grouped && (
          <div className="msg-head">
            <span className="msg-user">{m.user}{own && <span className="you"> (you)</span>}</span>
            <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
            {m.editedAt && !m.deleted && <span className="edited">edited</span>}
          </div>
        )}
        {m.replyTo && (
          <div className="reply-quote">
            <Icon name="reply" size={14} />
            <strong>{m.replyTo.user}</strong>
            <span>{m.replyTo.message || 'Original message was deleted'}</span>
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <label className="sr-only" htmlFor={`edit-${m._id}`}>Edit message</label>
            <textarea
              id={`edit-${m._id}`}
              value={draft}
              maxLength={LIMITS.message}
              rows={2}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
              }}
            />
            <div className="edit-actions">
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={saving || (!draft.trim() && !m.image)}>Save</button>
              <span className="hint">Enter to save, Esc to cancel</span>
            </div>
          </div>
        ) : m.deleted ? (
          <p className="msg-text deleted-text">This message was deleted.</p>
        ) : (
          <>
            {m.message && <p className="msg-text"><RichText text={m.message} me={me} /></p>}
            {m.image && (
              <button type="button" className="msg-image-btn" onClick={() => onOpenImage(m)} aria-label={`Open image from ${m.user}`}>
                <img className="msg-image" src={m.image} alt={`Attachment from ${m.user}`} loading="lazy" />
              </button>
            )}
          </>
        )}
        {m.reactions?.length > 0 && !m.deleted && (
          <div className="reactions" role="group" aria-label="Reactions">
            {m.reactions.map((r) => {
              const mine = r.users.includes(me);
              return (
                <button
                  type="button"
                  key={r.emoji}
                  className={`reaction${mine ? ' mine' : ''}`}
                  aria-pressed={mine}
                  aria-label={`${r.emoji} ${r.users.length} ${r.users.length === 1 ? 'reaction' : 'reactions'} from ${r.users.join(', ')}`}
                  title={r.users.join(', ')}
                  onClick={() => onReact(m, r.emoji)}
                >
                  <span aria-hidden="true">{r.emoji}</span> <span className="count">{r.users.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!m.deleted && !editing && (
        <div className="msg-actions" role="toolbar" aria-label="Message actions">
          <button type="button" className="icon-btn sm" data-emoji-trigger onClick={() => setPicker((v) => !v)} aria-label="Add reaction" aria-expanded={picker}><Icon name="smile" size={16} /></button>
          <button type="button" className="icon-btn sm" onClick={() => onReply(m)} aria-label="Reply"><Icon name="reply" size={16} /></button>
          {own && <button type="button" className="icon-btn sm" onClick={startEdit} aria-label="Edit message" disabled={!m.message}><Icon name="edit" size={16} /></button>}
          {own && <button type="button" className="icon-btn sm danger" onClick={() => onDelete(m)} aria-label="Delete message"><Icon name="trash" size={16} /></button>}
        </div>
      )}
      {picker && <div className="msg-picker"><EmojiPicker quick onPick={pick} onClose={() => setPicker(false)} label="Pick a reaction" /></div>}
    </li>
  );
}

export default memo(Message);
