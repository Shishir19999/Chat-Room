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

export const readSession = (key, fallback = '') => {
  try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
export const writeSession = (key, value) => {
  try { if (value == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* ignore */ }
};

export const KEYS = {
  profile: 'chat:profile',
  theme: 'chat:theme',
  accent: 'chat:accent',
  rooms: 'chat:rooms',
  secret: 'chat:secret',
  uid: 'chat:uid',
  tip: 'chat:dismissed',
  pref: (name) => `chat:pref:${name}`,
};

// Preferences used by the engine (sound, blocked people, ...) live under chat:pref:*.
export const prefs = {
  get: (name, fallback) => readJson(KEYS.pref(name), fallback),
  set: (name, value) => writeJson(KEYS.pref(name), value),
};
