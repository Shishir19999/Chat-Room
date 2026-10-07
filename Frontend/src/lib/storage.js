// Safe localStorage wrappers (private mode / blocked storage must not break the app).
export const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

export const removeKey = (key) => {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
};

export const KEYS = {
  user: 'chat:user',
  theme: 'chat:theme',
  sound: 'chat:sound',
  lastRead: (user) => `chat:lastread:${user}`,
};
