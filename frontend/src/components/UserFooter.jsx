import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../utils/api.js';
import Avatar from './Avatar.jsx';

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('rosterchirp-theme') === 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('rosterchirp-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark];
}

const PUSH_ENABLED_KEY = 'rc_push_enabled';

function usePushToggle() {
  // Show the toggle whenever the Notification API is present, not just when
  // already granted — so iOS users (where push is still being set up) can still
  // reach the toggle and trigger the permission request flow.
  const supported = 'serviceWorker' in navigator && typeof Notification !== 'undefined';
  const permitted = supported && Notification.permission === 'granted';
  const [enabled, setEnabled] = useState(() => localStorage.getItem(PUSH_ENABLED_KEY) !== 'false');

  const toggle = async () => {
    if (enabled) {
      // Disable: remove the server subscription so no pushes are sent
      try {
        const token = localStorage.getItem('tc_token') || sessionStorage.getItem('tc_token');
        await fetch('/api/push/unsubscribe', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch (e) { /* best effort */ }
      localStorage.removeItem('rc_fcm_token');
      localStorage.removeItem('rc_webpush_endpoint');
      localStorage.setItem(PUSH_ENABLED_KEY, 'false');
      setEnabled(false);
    } else {
      // Enable: re-run the registration flow
      localStorage.setItem(PUSH_ENABLED_KEY, 'true');
      setEnabled(true);
      window.dispatchEvent(new CustomEvent('rosterchirp:push-init'));
    }
  };

  return { supported, permitted, enabled, toggle };
}

// ── Debug helpers ─────────────────────────────────────────────────────────────
function DebugRow({ label, value, ok, bad }) {
  const color = ok ? 'var(--success)' : bad ? 'var(--error)' : 'var(--text-secondary)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color, fontFamily: 'monospace', fontSize: 12 }}>{value}</span>
    </div>
  );
}

// ── Test Notifications Modal ──────────────────────────────────────────────────
const isIOS     = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobileDevice = isIOS || isAndroid;

function TestNotificationsModal({ onClose }) {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [debugData, setDebugData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [permission, setPermission] = useState(
    (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported'
  );
  const [cachedToken, setCachedToken] = useState(localStorage.getItem('rc_fcm_token'));
  const [lastError,   setLastError]   = useState(localStorage.getItem('rc_fcm_error'));

  const load = async () => {
    if (!isAdmin) return; // debug endpoint is admin-only
    setLoading(true);
    try {
      const data = await api.pushDebug();
      setDebugData(data);
    } catch (e) {
      toast(e.message || 'Failed to load debug data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGrantPermission = async () => {
    if (typeof Notification === 'undefined') {
      toast('Notifications not supported on this device/browser', 'error');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      window.dispatchEvent(new CustomEvent('rosterchirp:push-init'));
      toast('Permission granted — registering…', 'success');
    } else {
      toast('Permission denied', 'error');
    }
  };

  const doTest = async (mode) => {
    setTesting(true);
    try {
      const result = await api.testPush(mode);
      const sent   = result.results?.find(r => r.status === 'sent');
      const failed = result.results?.find(r => r.status === 'failed');
      if (sent)         toast(`Test sent (mode=${mode}) — check device for notification`, 'success');
      else if (failed)  toast(`Test failed: ${failed.error}`, 'error');
      else              toast('No subscription found — grant permission and reload', 'error');
    } catch (e) {
      toast(e.message || 'Test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const clearToken = () => {
    localStorage.removeItem('rc_fcm_token');
    localStorage.removeItem('rc_fcm_error');
    setCachedToken(null);
    setLastError(null);
    toast('Cached token cleared — reload to re-register with server', 'info');
  };

  const reregister = () => {
    localStorage.removeItem('rc_fcm_token');
    localStorage.removeItem('rc_fcm_error');
    localStorage.removeItem('rc_webpush_endpoint'); // clear iOS webpush cache too
    setCachedToken(null);
    setLastError(null);
    window.dispatchEvent(new CustomEvent('rosterchirp:push-init'));
    toast('Re-registering push subscription…', 'info');
  };

  const box = { background: 'var(--surface-variant)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 14 };
  const sectionLabel = { fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Test Notifications</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* This device */}
        <div style={box}>
          <div style={sectionLabel}>This Device</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            <DebugRow label="Permission"        value={permission}  ok={permission === 'granted'}       bad={permission === 'denied'} />
            {!isIOS && !isAndroid && <DebugRow label="FCM token"  value={cachedToken ? cachedToken.slice(0, 36) + '…' : 'None'} ok={!!cachedToken} bad={!cachedToken} />}
            {isAndroid && (
              <div style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>FCM token</span>
                <div style={{ color: cachedToken ? 'var(--success)' : 'var(--error)', fontFamily: 'monospace', fontSize: 11, marginTop: 3, wordBreak: 'break-all', lineHeight: 1.5 }}>{cachedToken || 'None'}</div>
              </div>
            )}
            {!isIOS && debugData && <DebugRow label="FCM env vars"  value={debugData.fcmConfigured    ? 'Present' : 'Missing'} ok={debugData.fcmConfigured}    bad={!debugData.fcmConfigured} />}
            {!isIOS && debugData && <DebugRow label="Firebase Admin" value={debugData.firebaseAdminReady ? 'Ready'   : 'Not ready'} ok={debugData.firebaseAdminReady} bad={!debugData.firebaseAdminReady} />}
            {lastError && <DebugRow label="Last reg. error" value={lastError} bad={true} />}
          </div>
          {permission === 'default' && (
            <button className="btn btn-sm btn-primary" onClick={handleGrantPermission} style={{ marginBottom: 8 }}>
              Grant Permission
            </button>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={reregister}>Re-register</button>
            {!isIOS && <button className="btn btn-sm btn-secondary" onClick={clearToken}>Clear token</button>}
          </div>
        </div>

        {/* Test push */}
        <div style={box}>
          <div style={sectionLabel}>Send Test Notification to This Device</div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            <strong>notification</strong> — same path as real messages (SW <code>onBackgroundMessage</code>)<br/>
            <strong>browser</strong> — Chrome shows it directly, bypasses the SW (confirm delivery works)
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => doTest('notification')} disabled={testing}>
              {testing ? 'Sending…' : 'Test (notification)'}
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => doTest('browser')} disabled={testing}>
              {testing ? 'Sending…' : 'Test (browser)'}
            </button>
          </div>
        </div>

        {/* Registered devices — desktop only */}
        {!isMobileDevice && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="settings-section-label" style={{ margin: 0 }}>Registered Devices</div>
              <button className="btn btn-sm btn-secondary" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
            </div>

            {loading ? (
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading…</p>
            ) : !debugData?.subscriptions?.length ? (
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No FCM tokens registered.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {debugData.subscriptions.map(sub => (
                  <div key={sub.id} style={box}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{sub.name || sub.email}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--surface)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--border)' }}>{sub.device}</span>
                    </div>
                    <code style={{ fontSize: 10, color: 'var(--text-secondary)', wordBreak: 'break-all', lineHeight: 1.6, display: 'block' }}>
                      {sub.fcm_token}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function ConfirmToggleModal({ enabling, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 360 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>
          {enabling ? 'Enable Notifications' : 'Disable Notifications'}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
          {enabling
            ? 'Turn on push notifications for this device?'
            : 'Turn off push notifications? You will no longer receive alerts on this device.'}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={onConfirm}>
            {enabling ? 'Turn On' : 'Turn Off'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserFooter({ onProfile, onHelp, onAbout, mobileCompact=false }) {
  const { user, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [dark, setDark] = useTheme();
  const { supported: showPushToggle, enabled: pushEnabled, toggle: togglePush } = usePushToggle();
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showTestNotif, setShowTestNotif] = useState(false);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const handleLogout = async () => { await logout(); };

  const handleToggleConfirm = () => {
    togglePush();
    setShowConfirm(false);
    setShowMenu(false);
  };

  if (mobileCompact) return (
    <div style={{ position:'relative' }}>
      <button ref={btnRef} onClick={() => setShowMenu(!showMenu)} style={{ background:'none',border:'none',cursor:'pointer',padding:2,display:'flex',alignItems:'center' }}>
        <Avatar user={user} size="sm" />
      </button>
      {showMenu && (
        <div ref={menuRef} style={{ position:'absolute',right:0,top:'calc(100% + 4px)',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',boxShadow:'0 4px 16px rgba(0,0,0,0.15)',minWidth:180,zIndex:200 }}>
          <div style={{ padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:13,fontWeight:600 }}>{user?.display_name||user?.name}</div>
          {[['Profile',()=>{setShowMenu(false);onProfile?.();}],['Help',()=>{setShowMenu(false);onHelp?.();}],['About',()=>{setShowMenu(false);onAbout?.();}]].map(([label,action])=>(
            <button key={label} onClick={action} style={{ display:'block',width:'100%',padding:'11px 14px',textAlign:'left',fontSize:14,background:'none',border:'none',cursor:'pointer',color:'var(--text-primary)' }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--background)'} onMouseLeave={e=>e.currentTarget.style.background=''}>{label}</button>
          ))}
          {showPushToggle && (
            <button onClick={() => { setShowMenu(false); setShowConfirm(true); }} style={{ display:'flex',alignItems:'center',width:'100%',padding:'11px 14px',fontSize:14,background:'none',border:'none',cursor:'pointer',color:'var(--text-primary)' }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--background)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
              <span style={{ flex:1, textAlign:'left' }}>Notifications</span>
              <span style={{ fontSize:12,fontWeight:700,color: pushEnabled ? '#22c55e' : '#ef4444' }}>{pushEnabled ? 'ON' : 'OFF'}</span>
            </button>
          )}
          {showPushToggle && pushEnabled && (
            <button onClick={() => { setShowMenu(false); setShowTestNotif(true); }} style={{ display:'block',width:'100%',padding:'11px 14px',textAlign:'left',fontSize:14,background:'none',border:'none',cursor:'pointer',color:'var(--primary)' }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--background)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
              Test Notifications
            </button>
          )}
          <div style={{ borderTop:'1px solid var(--border)' }}>
            <button onClick={handleLogout} style={{ display:'block',width:'100%',padding:'11px 14px',textAlign:'left',fontSize:14,background:'none',border:'none',cursor:'pointer',color:'var(--error)' }}>Sign out</button>
          </div>
        </div>
      )}
      {showConfirm && <ConfirmToggleModal enabling={!pushEnabled} onConfirm={handleToggleConfirm} onCancel={() => setShowConfirm(false)} />}
      {showTestNotif && <TestNotificationsModal onClose={() => setShowTestNotif(false)} />}
    </div>
  );

  return (
    <div className="sidebar-footer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button ref={btnRef} className="user-footer-btn" style={{ flex: 1 }} onClick={() => setShowMenu(!showMenu)}>
          <Avatar user={user} size="sm" />
          <div className="flex-col flex-1 overflow-hidden" style={{ textAlign: 'left' }}>
            <span className="font-medium text-sm truncate">{user?.display_name || user?.name}</span>
            <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{user?.role}</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
          </svg>
        </button>
        <button className="btn-icon" onClick={() => setDark(d => !d)} title={dark ? 'Light mode' : 'Dark mode'} style={{ flexShrink: 0, padding: 8 }}>
          {dark ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
      </div>

      {showMenu && (
        <div ref={menuRef} className="footer-menu">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', paddingLeft: 4 }}>User Menu</span>
            <button onClick={() => setShowMenu(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-tertiary)', lineHeight: 1 }} aria-label="Close menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <button className="footer-menu-item" onClick={() => { setShowMenu(false); onProfile?.(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Profile
          </button>
          <button className="footer-menu-item" onClick={() => { setShowMenu(false); onHelp?.(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            Help
          </button>
          <button className="footer-menu-item" onClick={() => { setShowMenu(false); onAbout?.(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            About
          </button>
          {showPushToggle && (
            <button className="footer-menu-item" onClick={() => { setShowMenu(false); setShowConfirm(true); }}>
              {pushEnabled ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              )}
              <span style={{ flex: 1, textAlign: 'left' }}>Notifications</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: pushEnabled ? '#22c55e' : '#ef4444' }}>{pushEnabled ? 'ON' : 'OFF'}</span>
            </button>
          )}
          {showPushToggle && pushEnabled && (
            <button className="footer-menu-item" onClick={() => { setShowMenu(false); setShowTestNotif(true); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Test Notifications
            </button>
          )}
          <hr className="divider" style={{ margin: '4px 0' }} />
          <button className="footer-menu-item danger" onClick={handleLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign out
          </button>
        </div>
      )}

      {showConfirm && <ConfirmToggleModal enabling={!pushEnabled} onConfirm={handleToggleConfirm} onCancel={() => setShowConfirm(false)} />}
      {showTestNotif && <TestNotificationsModal onClose={() => setShowTestNotif(false)} />}
    </div>
  );
}
