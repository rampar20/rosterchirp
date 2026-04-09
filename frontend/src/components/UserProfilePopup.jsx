import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { api } from '../utils/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function UserProfilePopup({ user: profileUser, anchorEl, onClose, onDirectMessage }) {
  const { user: currentUser } = useAuth();
  const popupRef = useRef(null);
  const [starting, setStarting] = useState(false);

  const isSelf = currentUser?.id === profileUser?.id;

  useEffect(() => {
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target) &&
          anchorEl && !anchorEl.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorEl, onClose]);

  useEffect(() => {
    if (!popupRef.current || !anchorEl) return;
    const anchor = anchorEl.getBoundingClientRect();
    const popup = popupRef.current;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let top = anchor.bottom + 8;
    let left = anchor.left;

    if (top + 260 > viewportH) top = anchor.top - 268;
    if (left + 220 > viewportW) left = viewportW - 228;

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }, [anchorEl]);

  const [dmError, setDmError] = useState('');
  const handleDM = async () => {
    if (!onDirectMessage) return;
    setStarting(true);
    setDmError('');
    try {
      const { group } = await api.createGroup({
        type: 'private',
        memberIds: [profileUser.id],
        isDirect: true,
      });
      onClose();
      onDirectMessage(group);
    } catch (e) {
      if (e.message?.includes('DM_RESTRICTED') || e.message?.includes('not permitted')) {
        setDmError('Direct messages with this user are not permitted.');
      } else {
        console.error('DM error', e);
      }
    } finally {
      setStarting(false);
    }
  };

  if (!profileUser) return null;

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        zIndex: 1000,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
        width: 220,
        padding: '20px 16px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Avatar user={profileUser} size="xl" />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 2 }}>
          {profileUser.name}
        </div>
        {profileUser.role === 'admin' && !profileUser.hide_admin_tag && (
          <span className="role-badge role-admin" style={{ fontSize: 11 }}>Admin</span>
        )}
      </div>
      {profileUser.about_me && (
        <p style={{
          fontSize: 13, color: 'var(--text-secondary)',
          textAlign: 'center', lineHeight: 1.5,
          marginTop: 4, wordBreak: 'break-word',
          borderTop: '1px solid var(--border)',
          paddingTop: 10, width: '100%',
        }}>
          {profileUser.about_me}
        </p>
      )}
      {!isSelf && onDirectMessage && (
        <>
          {dmError && (
            <div style={{ fontSize:12, color:'var(--error)', padding:'4px 0', textAlign:'center' }}>{dmError}</div>
          )}
          {profileUser.allow_dm === 0 ? (
          <p style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
          }}>
            DMs disabled by user
          </p>
        ) : (
          <button
            onClick={handleDM}
            disabled={starting}
            style={{
              marginTop: 6,
              width: '100%',
              padding: '8px 0',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--primary)',
              background: 'transparent',
              color: 'var(--primary)',
              fontSize: 13,
              fontWeight: 600,
              cursor: starting ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'background var(--transition), color var(--transition)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = 'white'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--primary)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            {starting ? 'Opening...' : 'Direct Message'}
          </button>
        )}
        </>
      )}
    </div>
  );
}
