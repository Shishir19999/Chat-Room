import { useCallback, useEffect, useState } from 'react';
import { KEYS, readJson, writeJson } from '../lib/storage.js';

const systemTheme = () => (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const initialTheme = () => {
  const saved = readJson(KEYS.theme, null);
  return saved === 'light' || saved === 'dark' ? saved : systemTheme();
};

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f1220' : '#f4f5fb');
}

// Light/dark theme: follows the OS until the visitor picks one, then remembers the choice.
export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  const [chosen, setChosen] = useState(() => readJson(KEYS.theme, null) !== null);

  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    if (chosen) return undefined;
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = () => setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [chosen]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      writeJson(KEYS.theme, next);
      return next;
    });
    setChosen(true);
  }, []);

  return { theme, toggle };
}
