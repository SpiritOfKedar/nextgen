import { useAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { isWorkbenchActiveAtom } from './store/atoms';
import { useChat } from './hooks/useChat';
import { LandingPage } from './components/LandingPage';
import { MainLayout } from './components/Layout/MainLayout';
import { AnimatePresence, motion } from 'framer-motion';

function App() {
  const [isWorkbenchActive] = useAtom(isWorkbenchActiveAtom);
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { loadThread } = useChat();
  const hasRestored = useRef(false);

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

  // Restore last session on refresh
  useEffect(() => {
    if (!isLoaded || !isSignedIn || hasRestored.current) return;
    const savedThreadId = localStorage.getItem('currentThreadId');
    if (savedThreadId) {
      console.log('[App] Restoring thread:', savedThreadId);
      hasRestored.current = true;
      loadThread(savedThreadId);
    }
  }, [isLoaded, isSignedIn, loadThread]);

  return (
    <AnimatePresence mode="wait">
      {!isWorkbenchActive ? (
        <motion.div
          key="landing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.98, filter: 'blur(10px)' }}
          transition={{ duration: 0.5 }}
        >
          <LandingPage />
        </motion.div>
      ) : (
        <motion.div
          key="workbench"
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <MainLayout />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;
