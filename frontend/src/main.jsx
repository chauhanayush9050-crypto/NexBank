import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { store } from './store';
import App from './App';
import './index.css';

function SplashScreen() {
  return (
    <motion.div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--bg-primary)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div
        className="text-center"
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 1.04 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      >
        <motion.div
          className="w-20 h-20 mx-auto mb-6 rounded-3xl gradient-bg flex items-center justify-center text-white font-bold text-4xl shadow-2xl"
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          N
        </motion.div>
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>NexBank</h1>
        <p className="text-sm md:text-base" style={{ color: 'var(--text-secondary)' }}>Smart Banking Platform</p>
      </motion.div>
    </motion.div>
  );
}

function Root() {
  const [showSplash, setShowSplash] = React.useState(true);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence mode="wait">
      {showSplash ? <SplashScreen key="splash" /> : <App key="app" />}
    </AnimatePresence>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <Root />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'var(--toast-bg)',
              color: 'var(--toast-color)',
              borderRadius: '12px',
              padding: '16px',
            },
            success: { iconTheme: { primary: '#48bb78', secondary: '#fff' } },
            error: { iconTheme: { primary: '#e53e3e', secondary: '#fff' } },
          }}
        />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
);
