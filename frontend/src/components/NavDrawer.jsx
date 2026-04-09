import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import './NavDrawer.css';

const NAV_ICON = {
  messages:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  groupmessages: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  schedules:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  users:         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  groups:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>,
  branding:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 1 0 10 10"/></svg>,
  hostpanel:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  settings:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M12 2v2M12 20v2M4.93 4.93l1.41 1.41M18.66 18.66l1.41 1.41M2 12h2M20 12h2"/></svg>,
};

export default function NavDrawer({ open, onClose, onMessages, onGroupMessages, onSchedule, onScheduleManager, onBranding, onSettings, onUsers, onGroupManager, onHostPanel, onAddChild, features = {}, currentPage = 'chat', isMobile = false, unreadMessages = false, unreadGroupMessages = false }) {
  const { user } = useAuth();
  const drawerRef = useRef(null);
  const isAdmin = user?.role === 'admin';
  const userGroupIds = features.userGroupMemberships || [];
  const canAccessTools = isAdmin || user?.role === 'manager' || (features.teamToolManagers || []).some(gid => userGroupIds.includes(gid));
  const hasUserGroups = userGroupIds.length > 0;
  const showAddChild = (features.loginType === 'guardian_only' || features.loginType === 'mixed_age') && features.inGuardiansGroup;

  useEffect(() => {
    if (!open) return;
    const h = e => { if (drawerRef.current && !drawerRef.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const item = (icon, label, onClick, opts = {}) => {
    const { active, disabled, badge, dot } = opts;
    return (
      <button
        className={`nav-drawer-item${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        onClick={disabled ? undefined : () => { onClose(); onClick(); }}
        disabled={disabled}
      >
        {icon}
        <span>{label}</span>
        {badge && <span className="nav-drawer-badge">{badge}</span>}
        {dot && <span className="nav-drawer-unread-dot" />}
      </button>
    );
  };

  return (
    <>
      <div className={`nav-drawer-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <div ref={drawerRef} className={`nav-drawer${open ? ' open' : ''}`}>

        {/* Close X */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>User Menu</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }} aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* User section */}
        {item(NAV_ICON.messages,      'Messages',        onMessages,      { active: currentPage === 'chat',         dot: unreadMessages })}
        {hasUserGroups && (features.msgGroup ?? true) && item(NAV_ICON.groupmessages, 'Group Messages', onGroupMessages, { active: currentPage === 'groupmessages', dot: unreadGroupMessages })}
        {features.scheduleManager && item(NAV_ICON.schedules, 'Schedules', onSchedule, { active: currentPage === 'schedule' })}

        {/* Admin section */}
        {isAdmin && (
          <>
            <div className="nav-drawer-section-label admin">Admin</div>
            {features.branding && item(NAV_ICON.branding, 'Branding', onBranding)}
            {item(NAV_ICON.settings, 'Settings', onSettings)}
            {features.isHostDomain && item(NAV_ICON.hostpanel, 'Control Panel', onHostPanel, { active: currentPage === 'hostpanel' })}
          </>
        )}

        {/* Tools section */}
        {(canAccessTools || showAddChild) && (
          <>
            <div className="nav-drawer-section-label admin">Tools</div>
            {canAccessTools && item(NAV_ICON.users, 'User Manager', onUsers, { active: currentPage === 'users' })}
            {canAccessTools && features.groupManager && item(NAV_ICON.groups, 'Group Manager', onGroupManager, { active: currentPage === 'groups' })}
            {showAddChild && onAddChild && item(
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>,
              'Family Manager',
              onAddChild
            )}
          </>
        )}
      </div>
    </>
  );
}
