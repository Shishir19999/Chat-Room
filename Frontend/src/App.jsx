import { HashRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Toasts.jsx';
import Landing from './pages/Landing.jsx';
import ChatPage from './pages/ChatPage.jsx';
import NotFound from './pages/NotFound.jsx';
import { useTheme } from './hooks/useTheme.js';

export default function App() {
  const theme = useTheme();
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Landing theme={theme.theme} onToggleTheme={theme.toggle} />} />
          <Route path="/join/:ws" element={<Landing theme={theme.theme} onToggleTheme={theme.toggle} />} />
          <Route path="/chat/:ws?" element={<ChatPage theme={theme} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
