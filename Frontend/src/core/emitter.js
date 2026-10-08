// Tiny event emitter used by the engine and transports.
export function createEmitter() {
  const handlers = new Map();
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => handlers.get(event)?.delete(fn);
    },
    emit(event, payload, ...rest) {
      for (const fn of [...(handlers.get(event) || [])]) {
        try { fn(payload, ...rest); } catch (e) { console.error(e); }
      }
    },
  };
}
