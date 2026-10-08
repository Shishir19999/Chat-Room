import { useCallback, useEffect, useState } from 'react';
import { KEYS, readJson, writeJson } from '../lib/storage.js';

export const ACCENTS = [
  { id: 'indigo', label: 'Indigo', hue: 245, l: 45 },
  { id: 'teal', label: 'Teal', hue: 178, l: 30 },
  { id: 'rose', label: 'Rose', hue: 338, l: 42 },
  { id: 'amber', label: 'Amber', hue: 32, l: 33 },
  { id: 'green', label: 'Green', hue: 142, l: 28 },
];

const systemTheme = () => (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const initialChoice = () => {
  const saved = readJson(KEYS.theme, null);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
};

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e1120' : '#f5f6fa');
}

export function applyAccent(id) {
  const accent = ACCENTS.find((a) => a.id === id) || ACCENTS[0];
  document.documentElement.dataset.accent = accent.id;
  document.documentElement.style.setProperty('--h', String(accent.hue));
  document.documentElement.style.setProperty('--l', `${accent.l}%`);
}

// Theme: light, dark or "system" (follows the OS until a choice is made). Accent colour is remembered too.
export function useTheme() {
  const [choice, setChoiceState] = useState(initialChoice);
  const [system, setSystem] = useState(systemTheme);
  const [accent, setAccentState] = useState(() => readJson(KEYS.accent, 'indigo'));
  const theme = choice === 'system' ? system : choice;

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => {
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setChoice = useCallback((value) => {
    setChoiceState(value);
    writeJson(KEYS.theme, value === 'system' ? null : value);
  }, []);
  const toggle = useCallback(() => setChoice(theme === 'dark' ? 'light' : 'dark'), [theme, setChoice]);
  const setAccent = useCallback((id) => { setAccentState(id); writeJson(KEYS.accent, id); }, []);

  return { theme, choice, setChoice, toggle, accent, setAccent };
}
