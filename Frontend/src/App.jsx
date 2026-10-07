import { useCallback, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Toasts.jsx';
import Landing from './pages/Landing.jsx';
import ChatRoom from './ChatRoom.jsx';
import NotFound from './pages/NotFound.jsx';
import { useTheme } from './hooks/useTheme.js';
import { KEYS, readJson, removeKey, writeJson } from './lib/storage.js';

export default function App() {
  const { theme, toggle } = useTheme();
  const [user, setUserState] = useState(() => readJson(KEYS.user, ''));
  const setUser = useCallback((name) => {
    if (name) writeJson(KEYS.user, name); else removeKey(KEYS.user);
    setUserState(name || '');
  }, []);
  const shared = { user, setUser, theme, onToggleTheme: toggle };

  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Landing {...shared} />} />
          <Route path="/chat/:room?" element={<ChatRoom {...shared} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
