import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Modes:
//   (default)         full-stack app, talks to the Express/Socket.IO backend (VITE_API_URL)
//   --mode demo       browser-only demo backend (localStorage), base "/"
//   --mode pages      browser-only demo for GitHub Pages, base "/Chat-Room/" (override with VITE_BASE)
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo' || mode === 'pages' || process.env.VITE_DEMO === 'true';
  const base = process.env.VITE_BASE || (mode === 'pages' ? '/Chat-Room/' : '/');
  return {
    base,
    plugins: [react()],
    define: { 'import.meta.env.VITE_DEMO': JSON.stringify(String(demo)) },
    test: { environment: 'node', include: ['src/**/*.test.{js,jsx}'] },
  };
});
