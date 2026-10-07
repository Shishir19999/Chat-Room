import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { LIMITS, validateMessage } from '../lib/limits.js';
import { fileToDataUrl } from '../lib/image.js';

export default function Composer({ room, replyTo, onCancelReply, onSend, onTyping, disabled, offlineHint, onError, ref }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const input = useRef(null);
  const file = useRef(null);
  const typingStop = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    insert: (value) => {
      setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${value} `.slice(0, LIMITS.message));
      input.current?.focus();
    },
  }));

  useEffect(() => { input.current?.focus(); }, [room, replyTo]);
  useEffect(() => () => clearTimeout(typingStop.current), []);

  // Auto-grow the textarea (up to ~5 lines).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [text]);

  const attach = async (f) => {
    if (!f) return;
    setAttaching(true);
    setError('');
    try { setImage(await fileToDataUrl(f)); } catch (e) { setError(e.message); onError?.(e.message); } finally { setAttaching(false); }
  };

  const change = (e) => {
    setText(e.target.value);
    setError('');
    onTyping(true);
    clearTimeout(typingStop.current);
    typingStop.current = setTimeout(() => onTyping(false), 1800);
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || disabled) return;
    const problem = validateMessage(text, Boolean(image));
    if (problem) { setError(problem); return; }
    const payload = { message: text.trim(), image: image || undefined, replyTo: replyTo?._id };
    setBusy(true);
    setError('');
    clearTimeout(typingStop.current);
    onTyping(false);
    try {
      await onSend(payload);
      setText('');
      setImage(null);
      onCancelReply();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const onPaste = (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); attach(f); }
  };

  const remaining = LIMITS.message - text.length;
  const errorId = 'composer-error';

  return (
    <form className="composer" onSubmit={submit} noValidate>
      {replyTo && (
        <div className="composer-reply">
          <Icon name="reply" size={16} />
          <span>Replying to <strong>{replyTo.user}</strong>: {replyTo.message || 'image'}</span>
          <button type="button" className="icon-btn sm" onClick={onCancelReply} aria-label="Cancel reply"><Icon name="close" size={16} /></button>
        </div>
      )}
      {image && (
        <div className="composer-image">
          <img src={image} alt="Attachment preview" />
          <button type="button" className="icon-btn sm" onClick={() => setImage(null)} aria-label="Remove image"><Icon name="close" size={16} /></button>
        </div>
      )}
      {offlineHint && <p className="composer-note" role="status">{offlineHint}</p>}
      <div className="composer-row">
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" tabIndex={-1} aria-label="Attach an image"
          onChange={(e) => { attach(e.target.files[0]); e.target.value = ''; }} />
        <button type="button" className="icon-btn" onClick={() => file.current.click()} aria-label="Attach image" disabled={attaching}><Icon name="image" /></button>
        <div className="emoji-anchor">
          <button type="button" className="icon-btn" data-emoji-trigger onClick={() => setPicker((v) => !v)} aria-label="Insert emoji" aria-expanded={picker}><Icon name="smile" /></button>
          {picker && (
            <div className="composer-picker">
              <EmojiPicker
                label="Insert emoji"
                onClose={() => setPicker(false)}
                onPick={(emoji) => { setText((t) => `${t}${emoji}`.slice(0, LIMITS.message)); input.current?.focus(); }}
              />
            </div>
          )}
        </div>
        <label className="sr-only" htmlFor="composer-input">Message #{room}</label>
        <textarea
          id="composer-input"
          ref={input}
          rows={1}
          value={text}
          placeholder={`Message #${room}`}
          onChange={change}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          maxLength={LIMITS.message + 50}
        />
        <button type="submit" className="btn btn-primary send" disabled={disabled || busy || attaching} aria-label="Send message"><Icon name="send" size={18} /><span className="send-label">Send</span></button>
      </div>
      <div className="composer-meta">
        <span id={errorId} className="field-error" role="alert">{error}</span>
        {text.length > 400 && <span className={`counter${remaining < 0 ? ' over' : ''}`}>{remaining}</span>}
      </div>
    </form>
  );
}
