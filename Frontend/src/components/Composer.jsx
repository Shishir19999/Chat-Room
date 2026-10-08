import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import VoiceRecorder from './VoiceRecorder.jsx';
import { LIMITS } from '../core/constants.js';
import { prepareImage, validateFile } from '../lib/media.js';
import { formatBytes, isImageMime } from '../lib/format.js';

const drafts = new Map(); // channel -> unsent text (kept while switching channels)

// Message box: Enter sends, Shift+Enter adds a line, Up edits your last message, @ suggests people.
export default function Composer({ channel, draftKey = channel, engine, people, reply, editing, onCancelReply, onCancelEdit, onEditLast, toast, incomingFile, placeholder, ariaLabel = 'Message' }) {
  const [text, setText] = useState(() => (editing ? editing.text : drafts.get(draftKey) || ''));
  const [pending, setPending] = useState(null); // { blob, name, mime, kind, w, h }
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState(null); // { start, query, index }
  const area = useRef(null);
  const file = useRef(null);
  const handled = useRef(null);
  const typingOff = useRef(0);
  const hintId = useId();
  const listId = useId();

  const resize = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);
  useEffect(resize, [text, resize]);
  useEffect(() => { if (editing || reply) area.current?.focus(); }, [editing, reply]);
  useEffect(() => { if (!globalThis.matchMedia?.('(pointer: coarse)').matches) area.current?.focus(); }, [channel]);
  useEffect(() => () => engine.setTyping(channel, false), [engine, channel]);

  const attachFile = useCallback(async (f) => {
    if (!f) return;
    try {
      if (isImageMime(f.type)) {
        const img = await prepareImage(f);
        setPending({ ...img, kind: 'image' });
      } else {
        const problem = validateFile(f);
        if (problem) { toast(problem, 'error'); return; }
        setPending({ blob: f, name: f.name, mime: (f.type || 'application/octet-stream').split(';')[0], kind: 'file' });
      }
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => {
    if (incomingFile && handled.current !== incomingFile.n) { handled.current = incomingFile.n; attachFile(incomingFile.file); }
  }, [incomingFile, attachFile]);

  const setDraft = (value) => { setText(value); if (!editing) drafts.set(draftKey, value); };

  const onChange = (e) => {
    const value = e.target.value;
    setDraft(value);
    const caret = e.target.selectionStart;
    const m = /(?:^|\s)@([A-Za-z0-9_.-]{0,24})$/.exec(value.slice(0, caret));
    setMention(m ? { start: caret - m[1].length - 1, query: m[1].toLowerCase(), index: 0 } : null);
    if (value.trim()) {
      engine.setTyping(channel, true);
      clearTimeout(typingOff.current);
      typingOff.current = setTimeout(() => engine.setTyping(channel, false), 4000);
    } else engine.setTyping(channel, false);
    engine.activity();
  };

  const candidates = useMemo(() => {
    if (!mention) return [];
    const list = people.filter((p) => p.name.toLowerCase().startsWith(mention.query) && p.uid !== engine.me.uid && !p.blocked).slice(0, 6);
    // A complete name needs no suggestion: Enter should just send.
    return list.length === 1 && list[0].name.toLowerCase() === mention.query ? [] : list;
  }, [mention, people, engine]);

  const insertMention = (p) => {
    const before = text.slice(0, mention.start);
    const after = text.slice(area.current.selectionStart);
    const next = `${before}@${p.name} ${after}`;
    setDraft(next);
    setMention(null);
    requestAnimationFrame(() => { const pos = before.length + p.name.length + 2; area.current.focus(); area.current.setSelectionRange(pos, pos); });
  };

  const sendNow = async ({ stk } = {}) => {
    if (busy) return;
    const body = text.trim();
    if (editing) {
      const r = engine.edit(editing.id, channel, body);
      if (r.error) { toast(r.error, 'error'); return; }
      setText(''); onCancelEdit();
      return;
    }
    if (!body && !pending && !stk) return;
    let att = null;
    if (pending) {
      setBusy(true);
      try {
        att = await engine.addAttachment(pending.blob, { kind: pending.kind, name: pending.name, mime: pending.mime, w: pending.w, h: pending.h });
      } catch (e) {
        toast(e.message || 'Could not attach that file.', 'error');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    const r = engine.sendMessage(channel, { text: body, reply: reply?.id || null, att, stk: stk || null });
    if (r.error) { toast(r.error, 'error'); return; }
    setText(''); drafts.delete(draftKey); setPending(null); setMention(null);
    onCancelReply();
    clearTimeout(typingOff.current);
    requestAnimationFrame(() => area.current?.focus());
  };

  const sendVoice = async (blob, meta) => {
    try {
      const att = await engine.addAttachment(blob, { kind: 'voice', name: 'voice-note', mime: meta.mime, dur: meta.dur, wave: meta.wave });
      const r = engine.sendMessage(channel, { text: '', att, reply: reply?.id || null });
      if (r.error) toast(r.error, 'error'); else onCancelReply();
    } catch (e) { toast(e.message || 'Could not send the voice note.', 'error'); }
  };

  const onKeyDown = (e) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMention((m) => ({ ...m, index: (m.index + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(candidates[mention.index]); return; }
    }
    if (e.key === 'Escape') {
      if (mention) { setMention(null); return; }
      if (picker) { setPicker(false); return; }
      if (editing) { setText(''); onCancelEdit(); return; }
      if (reply) { onCancelReply(); return; }
      if (pending) { setPending(null); return; }
    }
    if (e.key === 'ArrowUp' && !text && !editing) { e.preventDefault(); onEditLast(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendNow(); }
  };

  const onPaste = (e) => {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) { e.preventDefault(); attachFile(f); }
  };

  const insertEmoji = (emoji) => {
    const el = area.current;
    const at = el.selectionStart ?? text.length;
    const next = text.slice(0, at) + emoji + text.slice(el.selectionEnd ?? at);
    setDraft(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + emoji.length, at + emoji.length); });
  };

  const left = LIMITS.text - text.length;
  const canSend = (text.trim() || pending) && !busy && left >= 0;

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); sendNow(); }} aria-label="Write a message">
      {(reply || editing) && (
        <div className="composer-note">
          <Icon name={editing ? 'edit' : 'reply'} size={14} />
          <span>{editing ? 'Editing your message' : <>Replying to <strong>{reply.name}</strong>: {reply.text}</>}</span>
          <button type="button" className="icon-btn" aria-label={editing ? 'Cancel editing' : 'Cancel reply'} onClick={() => { if (editing) { setText(''); onCancelEdit(); } else onCancelReply(); }}><Icon name="close" size={14} /></button>
        </div>
      )}
      {pending && (
        <div className="composer-note composer-attach">
          <Icon name={pending.kind === 'image' ? 'image' : 'file'} size={14} />
          <span>{pending.name} ({formatBytes(pending.blob.size)})</span>
          <button type="button" className="icon-btn" aria-label="Remove attachment" onClick={() => setPending(null)}><Icon name="close" size={14} /></button>
        </div>
      )}
      <div className="composer-row">
        {!editing && (
          <>
            <input ref={file} type="file" hidden onChange={(e) => { attachFile(e.target.files[0]); e.target.value = ''; }} aria-label="Choose a file to attach" />
            <button type="button" className="icon-btn" aria-label="Attach a file or picture" title={`Attach a file (up to ${Math.round(LIMITS.fileBytes / 1048576)} MB)`} onClick={() => file.current.click()}><Icon name="paperclip" /></button>
          </>
        )}
        <div className="composer-box">
          <textarea ref={area} rows={1} value={text} onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste}
            aria-label={ariaLabel} aria-describedby={hintId} placeholder={placeholder} maxLength={LIMITS.text + 200}
            aria-autocomplete={mention ? 'list' : undefined} aria-controls={mention && candidates.length ? listId : undefined} enterKeyHint="send" />
          {mention && candidates.length > 0 && (
            <ul className="mention-list" id={listId} role="listbox" aria-label="Mention someone">
              {candidates.map((p, i) => (
                <li key={p.uid} role="option" aria-selected={i === mention.index}>
                  <button type="button" tabIndex={-1} className={i === mention.index ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); insertMention(p); }}>@{p.name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="menu">
          <button type="button" className="icon-btn" data-picker-trigger aria-label="Emoji and stickers" aria-expanded={picker} onClick={() => setPicker((p) => !p)}><Icon name="smile" /></button>
          {picker && (
            <EmojiPicker onClose={() => setPicker(false)} onPick={insertEmoji}
              onSticker={editing ? undefined : (emoji) => { setPicker(false); sendNow({ stk: emoji }); }} />
          )}
        </span>
        {!editing && !text.trim() && !pending
          ? <VoiceRecorder onRecorded={sendVoice} onError={(m) => toast(m, 'error')} disabled={busy} />
          : <button type="submit" className="btn btn-primary send-btn" disabled={!canSend} aria-label={editing ? 'Save edit' : 'Send message'}><Icon name={editing ? 'check' : 'send'} size={18} /></button>}
      </div>
      <p id={hintId} className="composer-hint">
        {left < 300 ? <span className={left < 0 ? 'field-error' : ''}>{left} characters left. </span> : null}
        Enter to send, Shift+Enter for a new line. Markdown works: **bold**, _italic_, `code`.
      </p>
    </form>
  );
}
