import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { LIMITS } from '../core/constants.js';
import { baseMime, toWaveform, voiceMimeType } from '../lib/media.js';
import { formatDuration } from '../lib/format.js';

// Voice notes: asks for the microphone only when you press the button, records with MediaRecorder,
// shows a live level meter and sends a waveform + duration with the clip.
export default function VoiceRecorder({ onRecorded, onError, disabled }) {
  const [state, setState] = useState('idle'); // idle | starting | recording
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef(null);

  const cleanup = () => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
    rec.current = null;
  };
  useEffect(() => cleanup, []);

  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(voiceMimeType());

  const start = async () => {
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = voiceMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const samples = [];
      const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
      const ctx = AudioCtx ? new AudioCtx() : null;
      let analyser = null;
      if (ctx) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
      }
      const data = new Uint8Array(analyser ? analyser.fftSize : 0);
      const r = { stream, recorder, ctx, chunks, started: Date.now(), cancelled: false, timer: 0, raf: 0 };
      rec.current = r;
      const sample = () => {
        if (analyser) {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          samples.push(peak);
          setLevel(peak);
        }
        r.raf = requestAnimationFrame(sample);
      };
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const dur = (Date.now() - r.started) / 1000;
        const cancelled = r.cancelled;
        const type = baseMime(recorder.mimeType || mimeType || 'audio/webm');
        cleanup();
        setState('idle'); setSeconds(0); setLevel(0);
        if (cancelled || dur < 0.6) { if (!cancelled) onError('That was too short. Hold on a little longer.'); return; }
        onRecorded(new Blob(chunks, { type }), { dur: Math.round(dur * 10) / 10, wave: toWaveform(samples.filter((_, i) => i % 3 === 0)), mime: type });
      };
      recorder.start(250);
      r.raf = requestAnimationFrame(sample);
      r.timer = setInterval(() => {
        const s = (Date.now() - r.started) / 1000;
        setSeconds(s);
        if (s >= LIMITS.voiceSeconds) recorder.state === 'recording' && recorder.stop();
      }, 250);
      setState('recording');
    } catch (e) {
      cleanup();
      setState('idle');
      onError(e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
        ? 'Microphone access was blocked. Allow it in your browser settings to record voice notes.'
        : e?.name === 'NotFoundError' ? 'No microphone was found on this device.' : 'Could not start recording.');
    }
  };

  const stop = (cancel) => {
    const r = rec.current;
    if (!r) return;
    r.cancelled = cancel;
    if (r.recorder.state !== 'inactive') r.recorder.stop();
  };

  if (state === 'recording') {
    return (
      <div className="recording" role="group" aria-label="Recording voice note">
        <span className="rec-dot" aria-hidden="true" style={{ transform: `scale(${1 + level})` }} />
        <span className="rec-time" role="timer" aria-label={`Recording ${formatDuration(seconds)}`}>{formatDuration(seconds)}</span>
        <button type="button" className="icon-btn" onClick={() => stop(true)} aria-label="Cancel recording"><Icon name="trash" size={18} /></button>
        <button type="button" className="icon-btn send-ready" onClick={() => stop(false)} aria-label="Stop and send voice note"><Icon name="send" size={18} /></button>
      </div>
    );
  }
  return (
    <button type="button" className="icon-btn" onClick={start} disabled={disabled || !supported || state === 'starting'}
      aria-label="Record a voice note" title={supported ? 'Record a voice note' : 'Voice notes are not supported in this browser'}>
      <Icon name="mic" />
    </button>
  );
}
