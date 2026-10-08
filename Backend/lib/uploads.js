import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import Upload from '../models/Upload.js';
import { LIMITS } from '../shared/constants.js';

const ascii = (buf, from, to) => buf.subarray(from, to).toString('latin1');
const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
const noNul = (buf) => !buf.subarray(0, 4096).includes(0);

// Allowed types and a magic-number check for each (the declared mime type is never trusted on its own).
const SNIFFERS = {
    'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
    'image/gif': (b) => ascii(b, 0, 4) === 'GIF8',
    'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
    'audio/webm': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
    'audio/ogg': (b) => ascii(b, 0, 4) === 'OggS',
    'audio/mp4': (b) => ascii(b, 4, 8) === 'ftyp',
    'audio/mpeg': (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
    'audio/wav': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE',
    'application/pdf': (b) => ascii(b, 0, 4) === '%PDF',
    'application/zip': (b) => ascii(b, 0, 2) === 'PK',
    'text/plain': noNul,
    'text/csv': noNul,
    'text/markdown': noNul,
    'application/json': noNul,
};
const INLINE = (mime) => mime.startsWith('image/') || mime.startsWith('audio/');

export const normalizeMime = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();
export const isAllowedUpload = (mime, buffer) => Boolean(SNIFFERS[mime]) && buffer.length > 0 && SNIFFERS[mime](buffer);

const safeName = (name) => String(name || 'file').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').slice(0, 120) || 'file';

// tokens: Map(uploadToken -> { uid, ws }) filled when a socket joins a workspace.
export function createUploadsRouter({ tokens }) {
    const router = Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.fileBytes, files: 1, fields: 4 } });

    router.post('/uploads', (req, res) => {
        const auth = String(req.headers.authorization || '');
        const session = tokens.get(auth.startsWith('Bearer ') ? auth.slice(7) : '');
        if (!session) return res.status(401).json({ error: 'Join a room before uploading.' });
        upload.single('file')(req, res, async (err) => {
            if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Files can be at most 5 MB.' : 'Upload failed.' });
            const file = req.file;
            if (!file) return res.status(400).json({ error: 'No file received.' });
            const mime = normalizeMime(req.body?.mime || file.mimetype);
            if (!isAllowedUpload(mime, file.buffer)) return res.status(415).json({ error: 'This file type is not allowed.' });
            try {
                const id = randomBytes(10).toString('hex');
                await Upload.create({ id, w: session.ws, by: session.uid, name: safeName(req.body?.name || file.originalname), mime, size: file.size, data: file.buffer });
                return res.status(201).json({ id, url: `/uploads/${id}`, mime, size: file.size });
            } catch (e) {
                console.error(e.message);
                return res.status(500).json({ error: 'Could not store the file.' });
            }
        });
    });

    router.get('/uploads/:id', async (req, res) => {
        if (!/^[a-f0-9]{20}$/.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
        try {
            const doc = await Upload.findOne({ id: req.params.id }).lean();
            if (!doc) return res.status(404).json({ error: 'Not found' });
            const inline = INLINE(doc.mime);
            res.set({
                'Content-Type': inline ? doc.mime : 'application/octet-stream',
                'Content-Length': String(doc.size),
                'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.name)}"`,
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'none'; sandbox",
                'Cross-Origin-Resource-Policy': 'cross-origin',
                'Cache-Control': 'private, max-age=31536000, immutable',
            });
            return res.send(Buffer.from(doc.data.buffer ?? doc.data));
        } catch (e) {
            console.error(e.message);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    return router;
}
