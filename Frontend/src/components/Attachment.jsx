import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Dialog from './Dialog.jsx';
import { formatBytes, formatDuration, isImageMime } from '../lib/format.js';

// Attachments never load by themselves from other people (privacy): the receiver taps to fetch them.
// Files you sent, files already on this device and files from your own server load straight away.
export default function Attachment({ att, authorUid, mine, engine }) {
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);
  const urlRef = useRef('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const blob = await engine.getAttachment(att, authorUid);
      const typed = new Blob([blob], { type: att.kind === 'file' ? 'application/octet-stream' : att.mime });
      const next = URL.createObjectURL(typed);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = next;
      setUrl(next);
      setState('ready');
    } catch (e) {
      setError(e.message || 'Could not load this file.');
      setState('error');
    }
  }, [engine, att, authorUid]);

  useEffect(() => {
    let cancelled = false;
    const auto = mine || engine.autoLoadMedia;
    (async () => {
      const local = await engine.hasLocalAttachment(att).catch(() => false);
      if (cancelled) return;
      if ((local || auto) && att.kind !== 'file') load();
    })();
    return () => { cancelled = true; };
  }, [att, engine, mine, load]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const download = async () => {
    try {
      const blob = await engine.getAttachment(att, authorUid);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
      link.download = att.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    } catch (e) {
      setError(e.message || 'Download failed.');
      setState('error');
    }
  };

  const meta = `${att.name} - ${formatBytes(att.size)}`;
  const failure = state === 'error' && <p className="att-error" role="alert">{error} <button type="button" className="link-btn" onClick={load}>Try again</button></p>;

  if (att.kind === 'image' && isImageMime(att.mime)) {
    return (
      <div className="att att-image">
        {state === 'ready' ? (
          <button type="button" className="att-img-btn" onClick={() => setZoom(true)} aria-label={`Open picture ${att.name}`}>
            <img src={url} alt={att.name} width={att.w} height={att.h} style={att.w && att.h ? { aspectRatio: `${att.w} / ${att.h}` } : undefined} />
          </button>
        ) : (
          <button type="button" className="att-card" onClick={load} disabled={state === 'loading'}>
            <Icon name="image" size={22} />
            <span><strong>{state === 'loading' ? 'Loading picture...' : 'Show picture'}</strong><small>{meta}{att.w ? ` - ${att.w}x${att.h}` : ''}</small></span>
          </button>
        )}
        {failure}
        {zoom && (
          <Dialog title={att.name} onClose={() => setZoom(false)} footer={<button type="button" className="btn" onClick={download}><Icon name="download" size={16} /> Download</button>}>
            <img className="zoom-img" src={url} alt={att.name} />
          </Dialog>
        )}
      </div>
    );
  }

  if (att.kind === 'voice') {
    return (
      <div className="att att-voice">
        {state === 'ready'
          ? <VoicePlayer att={att} url={url} />
          : (
            <button type="button" className="att-card" onClick={load} disabled={state === 'loading'}>
              <Icon name="mic" size={22} />
              <span><strong>{state === 'loading' ? 'Loading voice note...' : 'Load voice note'}</strong><small>{formatDuration(att.dur)} - {formatBytes(att.size)}</small></span>
            </button>
          )}
        {failure}
      </div>
    );
  }

  return (
    <div className="att att-file">
      <button type="button" className="att-card" onClick={download}>
        <Icon name="file" size={22} />
        <span><strong>{att.name}</strong><small>{formatBytes(att.size)} - tap to download</small></span>
        <Icon name="download" size={18} />
      </button>
      {failure}
    </div>
  );
}

function VoicePlayer({ att, url }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const wave = att.wave?.length ? att.wave : new Array(32).fill(0.4);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  };
  const seek = (e) => {
    const el = audio.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * el.duration;
  };
  return (
    <div className="voice">
      <audio ref={audio} src={url} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} />
      <button type="button" className="icon-btn voice-play" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'}><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
      <div className="wave" role="slider" tabIndex={0} aria-label="Voice note position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
        onClick={seek} onKeyDown={(e) => { const el = audio.current; if (el?.duration && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) el.currentTime = Math.max(0, el.currentTime + (e.key === 'ArrowRight' ? 5 : -5)); }}>
        {wave.map((v, i) => <i key={i} className={i / wave.length < progress ? 'done' : ''} style={{ height: `${Math.round(18 + v * 82)}%` }} />)}
      </div>
      <span className="muted voice-time">{formatDuration(att.dur)}</span>
    </div>
  );
}
