import { useEffect, useState } from 'react';

export function useMedia(query) {
  const get = () => Boolean(globalThis.matchMedia?.(query).matches);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Parallax is decorative: off for reduced-motion, small screens and low-power devices.
export function motionAllowed() {
  if (typeof globalThis.matchMedia !== 'function') return false;
  if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (!globalThis.matchMedia('(min-width: 768px)').matches) return false;
  const nav = globalThis.navigator || {};
  if (nav.connection?.saveData) return false;
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) return false;
  if (nav.deviceMemory && nav.deviceMemory <= 2) return false;
  return true;
}

export function useParallaxEnabled() {
  const [on, setOn] = useState(motionAllowed);
  useEffect(() => {
    const queries = ['(prefers-reduced-motion: reduce)', '(min-width: 768px)'].map((q) => globalThis.matchMedia?.(q));
    const update = () => {
      const allowed = motionAllowed();
      setOn(allowed);
      document.documentElement.dataset.parallax = allowed ? 'on' : 'off';
    };
    update();
    queries.forEach((q) => q?.addEventListener('change', update));
    return () => queries.forEach((q) => q?.removeEventListener('change', update));
  }, []);
  return on;
}
