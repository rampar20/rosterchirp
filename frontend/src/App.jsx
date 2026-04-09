import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { SocketProvider } from './contexts/SocketContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Login from './pages/Login.jsx';
import Chat from './pages/Chat.jsx';
import ChangePassword from './pages/ChangePassword.jsx';

// ── iOS "Add to Home Screen" banner ───────────────────────────────────────────
// iOS Safari does not fire beforeinstallprompt. Push notifications require the
// app to be installed as a PWA. This banner is shown to any iOS Safari user who
// has not yet added the app to their Home Screen.
const IOS_BANNER_KEY = 'rc_ios_install_dismissed';

function IOSInstallBanner() {
  const isIOS       = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(IOS_BANNER_KEY) === '1');

  if (!isIOS || isStandalone || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(IOS_BANNER_KEY, '1');
    setDismissed(true);
  };

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--primary, #1a73e8)', color: '#fff',
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 -2px 12px rgba(0,0,0,0.25)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Add to Home Screen</div>
        <div style={{ fontSize: 12, lineHeight: 1.4, opacity: 0.9 }}>
          To receive push notifications, tap the{' '}
          <svg style={{ display: 'inline', verticalAlign: 'middle', margin: '0 2px' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
          {' '}Share button, then select <strong>"Add to Home Screen"</strong>.
        </div>
      </div>
      <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 4, flexShrink: 0, opacity: 0.9 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading, mustChangePassword } = useAuth();
  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" style={{ width: 36, height: 36 }} />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  return children;
}

function AuthRoute({ children }) {
  const { user, loading, mustChangePassword } = useAuth();
  document.documentElement.setAttribute('data-theme', 'light');
  if (loading) return null;
  if (user && !mustChangePassword) return <Navigate to="/" replace />;
  return children;
}

function RestoreTheme() {
  const saved = localStorage.getItem('rosterchirp-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <IOSInstallBanner />
        <Routes>
          {/* All routes go through jama auth */}
          <Route path="/*" element={
            <AuthProvider>
              <SocketProvider>
                <Routes>
                  <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
                  <Route path="/change-password" element={<ChangePassword />} />
                  <Route path="/" element={<ProtectedRoute><RestoreTheme /><Chat /></ProtectedRoute>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </SocketProvider>
            </AuthProvider>
          } />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
