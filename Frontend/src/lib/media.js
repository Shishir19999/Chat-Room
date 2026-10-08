import { LIMITS } from '../core/constants.js';

// Attachment preparation: validate type and size, shrink photos, pick a voice-note format.

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|pif|vbs|vbe|js|jse|wsf|ps1|jar|apk|dmg|app|sh|bin|dll|lnk|hta|reg)$/i;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_EDGE = 1600;

export function fitDimensions(width, height, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const baseMime = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();

const loadImage = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a valid image.')); };
  img.src = url;
});

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Resolves to { blob, name, mime, w, h } no larger than the file limit, or throws a friendly Error.
export async function prepareImage(file) {
  const type = baseMime(file.type);
  if (!IMAGE_TYPES.includes(type)) throw new Error('Only PNG, JPEG, GIF or WebP images can be sent as pictures.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is larger than 30 MB.');
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (type === 'image/gif') {
    if (file.size > LIMITS.fileBytes) throw new Error('That GIF is larger than 5 MB.');
    return { blob: file, name: file.name || 'image.gif', mime: type, w, h };
  }
  if (file.size <= 400 * 1024 && Math.max(w, h) <= MAX_EDGE) return { blob: file, name: file.name || 'image', mime: type, w, h };
  let edge = MAX_EDGE;
  for (let attempt = 0; attempt < 6; attempt++) {
    const dim = fitDimensions(w, h, edge);
    const canvas = document.createElement('canvas');
    canvas.width = dim.width;
    canvas.height = dim.height;
    canvas.getContext('2d').drawImage(img, 0, 0, dim.width, dim.height);
    const blob = await toBlob(canvas, 'image/jpeg', Math.max(0.5, 0.86 - attempt * 0.08));
    if (blob && blob.size <= LIMITS.fileBytes) {
      const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
      return { blob, name, mime: 'image/jpeg', w: dim.width, h: dim.height };
    }
    edge = Math.round(edge * 0.75);
  }
  throw new Error('That image is too large even after shrinking it.');
}

export function validateFile(file) {
  if (!file) return 'No file selected.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > LIMITS.fileBytes) return `Files can be at most ${Math.round(LIMITS.fileBytes / 1048576)} MB.`;
  if (BLOCKED_EXT.test(file.name || '')) return 'Programs and scripts cannot be shared in chat.';
  return '';
}

export function voiceMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* ignore */ }
  }
  return '';
}

// Reduces a list of amplitude samples (0..1) to `bars` normalized peaks.
export function toWaveform(samples, bars = LIMITS.wave) {
  if (!samples.length) return new Array(bars).fill(0.15);
  const out = [];
  const size = samples.length / bars;
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let peak = 0;
    for (let j = from; j < to && j < samples.length; j++) peak = Math.max(peak, samples[j]);
    out.push(peak);
  }
  const top = Math.max(...out, 0.05);
  return out.map((v) => Math.round(Math.min(1, Math.max(0.08, v / top)) * 100) / 100);
}
