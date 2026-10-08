/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useSyncExternalStore } from 'react';

const ChatContext = createContext(null);
export const ChatProvider = ChatContext.Provider;
export const useChat = () => useContext(ChatContext);

// Re-renders when the engine changes; returns the latest immutable snapshot.
export function useSnapshot(engine) {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}
