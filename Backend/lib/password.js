import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

const scryptAsync = (password, salt) => new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 2 ** 14, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});

export async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const key = await scryptAsync(String(password), salt);
    return { salt, hash: key.toString('hex') };
}

export async function verifyPassword(password, { salt, hash }) {
    if (!salt || !hash) return false;
    const key = await scryptAsync(String(password), salt);
    const expected = Buffer.from(hash, 'hex');
    return key.length === expected.length && timingSafeEqual(key, expected);
}

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function safeEqualHex(a, b) {
    const x = Buffer.from(String(a), 'hex');
    const y = Buffer.from(String(b), 'hex');
    return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
