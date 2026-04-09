import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext.jsx';
import { api } from '../utils/api.js';

export default function GlobalBar({ isMobile, showSidebar, onBurger, hasUnread = false }) {
  const { connected } = useSocket();
  const [settings, setSettings] = useState({ app_name: 'rosterchirp', logo_url: '' });
  const [isDark, setIsDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');

  useEffect(() => {
    api.getSettings().then(({ settings }) => setSettings(settings)).catch(() => {});
    const handler = () => api.getSettings().then(({ settings }) => setSettings(settings)).catch(() => {});
    window.addEventListener('rosterchirp:settings-changed', handler);
    const themeObserver = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      window.removeEventListener('rosterchirp:settings-changed', handler);
      themeObserver.disconnect();
    };
  }, []);

  const appName = settings.app_name || 'rosterchirp';
  const logoUrl = settings.logo_url;
  const titleColor = (isDark ? settings.color_title_dark : settings.color_title) || null;

  if (isMobile && !showSidebar) return null;

  return (
    <div className="global-bar">
      {/* Left side: burger + logo + title grouped together */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
        <button
          onClick={onBurger}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-primary)', padding: '4px 6px',
            display: 'flex', alignItems: 'center', flexShrink: 0, borderRadius: 8,
          }}
          title="Menu"
          aria-label="Open menu"
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            {hasUnread && (
              <span style={{
                position: 'absolute', bottom: -1, right: -1,
                width: 9, height: 9, borderRadius: '50%',
                background: 'var(--primary)',
                border: '2px solid var(--surface)',
                flexShrink: 0,
              }} />
            )}
          </div>
        </button>
        <div className="global-bar-brand">
          <img src={logoUrl || '/icons/rosterchirp.png'} alt={appName} className="global-bar-logo" />
          <span className="global-bar-title" style={titleColor ? { color: titleColor } : {}}>{appName}</span>
        </div>
      </div>

      {!connected && (
        <span className="global-bar-offline" title="Offline">
          <span className="offline-dot" />
          <span className="offline-label">Offline</span>
        </span>
      )}
    </div>
  );
}
