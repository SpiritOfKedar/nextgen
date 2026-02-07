import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useChat } from './hooks/useChat';
import { LandingPage } from './components/LandingPage';
import { MainLayout } from './components/Layout/MainLayout';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

function App() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { loadThread } = useChat();
  const location = useLocation();

  // Sync user to MongoDB as soon as they sign in
  useEffect(() => {
    const syncUser = async () => {
      if (!isLoaded || !isSignedIn) return;
      try {
        const token = await getToken();
        if (!token) return;
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
        await fetch(`${API_URL}/auth/sync`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('[App] User synced to MongoDB');
      } catch (err) {
        console.error('[App] Failed to sync user:', err);
      }
    };
    syncUser();
  }, [isLoaded, isSignedIn, getToken]);

  // Restore thread when landing on /builder with a saved thread
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (location.pathname === '/builder') {
      const savedThreadId = localStorage.getItem('currentThreadId');
      if (savedThreadId) {
        console.log('[App] Restoring thread:', savedThreadId);
        loadThread(savedThreadId);
      }
    }
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98, filter: 'blur(10px)' }}
              transition={{ duration: 0.4 }}
            >
              <LandingPage />
            </motion.div>
          }
        />
        <Route
          path="/builder"
          element={
            <motion.div
              key="workbench"
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="h-screen"
            >
              <MainLayout />
            </motion.div>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

export default App;
