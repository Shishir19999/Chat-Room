// Image attachments: validate, downscale and encode as a size-limited data URL.
import { LIMITS } from './limits.js';

export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1280;
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function fitDimensions(width, height, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read that file.'));
  reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('That file is not a valid image.'));
  img.src = src;
});

// Resolves to a data URL no longer than LIMITS.image characters, or throws an Error with a friendly message.
export async function fileToDataUrl(file) {
  if (!file || !TYPES.includes(file.type)) throw new Error('Only PNG, JPEG, GIF or WebP images can be attached.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is larger than 8 MB.');
  const original = await readAsDataUrl(file);
  if (original.length <= LIMITS.image && file.type === 'image/gif') return original;
  if (file.type === 'image/gif') throw new Error('That GIF is too large. Use an image under about 300 KB.');
  const img = await loadImage(original);
  let edge = MAX_EDGE;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, edge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL('image/jpeg', Math.max(0.5, 0.85 - attempt * 0.08));
    if (out.length <= LIMITS.image) return out;
    edge = Math.round(edge * 0.75);
  }
  throw new Error('That image is too large even after shrinking it.');
}
