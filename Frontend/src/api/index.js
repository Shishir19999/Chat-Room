// Picks the server layer at build time: the in-browser demo (VITE_DEMO=true) or the real backend.
export const IS_DEMO = import.meta.env.VITE_DEMO === 'true';
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export async function createClient() {
  if (IS_DEMO) {
    const { createDemoClient } = await import('./demo/demoClient.js');
    return createDemoClient();
  }
  const { createRealClient } = await import('./realClient.js');
  return createRealClient({ url: API_URL });
}
