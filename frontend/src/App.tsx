import { useAtom } from 'jotai';
import { isWorkbenchActiveAtom } from './store/atoms';
import { LandingPage } from './components/LandingPage';
import { MainLayout } from './components/Layout/MainLayout';
import { AnimatePresence, motion } from 'framer-motion';

function App() {
  const [isWorkbenchActive] = useAtom(isWorkbenchActiveAtom);

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
