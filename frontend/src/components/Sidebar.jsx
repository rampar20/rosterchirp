import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useSocket } from '../contexts/SocketContext.jsx';
import { api, parseTS } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import Avatar from './Avatar.jsx';
import './Sidebar.css';
import UserFooter from './UserFooter.jsx';

// Must match Avatar.jsx exactly so sidebar colours are consistent with message avatars
const AVATAR_COLORS = ['#1a73e8','#ea4335','#34a853','#fa7b17','#a142f4','#00897b','#e91e8c','#0097a7'];
function nameToColor(name) {
  return AVATAR_COLORS[(name || '').charCodeAt(0) % AVATAR_COLORS.length];
}

// Layouts for composite avatars inside a 44×44 circle (all values in px)
const COMPOSITE_LAYOUTS = {
  1: [{ top: 4, left: 4, size: 36 }],
  2: [
    { top: 11, left: 1, size: 21 },
    { top: 11, right: 1, size: 21 },
  ],
  3: [
    { top: 2, left: 3, size: 19 },
    { top: 2, right: 3, size: 19 },
    { bottom: 2, left: 12, size: 19 },
  ],
  4: [
    { top: 1, left: 1, size: 20 },
    { top: 1, right: 1, size: 20 },
    { bottom: 1, left: 1, size: 20 },
    { bottom: 1, right: 1, size: 20 },
  ],
};

function GroupAvatarComposite({ memberPreviews }) {
  const members = (memberPreviews || []).slice(0, 4);
  const n = members.length;
  const positions = COMPOSITE_LAYOUTS[n];

  if (!positions) {
    return (
      <div className="group-icon" style={{ background: '#a142f4', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
        ?
      </div>
    );
  }

  return (
    <div className="group-icon" style={{ background: 'transparent', position: 'relative', padding: 0, overflow: 'visible' }}>
      {members.map((m, i) => {
        const pos = positions[i];
        const base = {
          position: 'absolute',
          width: pos.size,
          height: pos.size,
          borderRadius: '50%',
          boxSizing: 'border-box',
          border: '2px solid var(--surface)',
          ...(pos.top    !== undefined ? { top:    pos.top    } : {}),
          ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
          ...(pos.left   !== undefined ? { left:   pos.left   } : {}),
          ...(pos.right  !== undefined ? { right:  pos.right  } : {}),
          overflow: 'hidden',
          flexShrink: 0,
        };
        if (m.avatar) {
          return <img key={m.id} src={m.avatar} alt={m.name} style={{ ...base, objectFit: 'cover' }} />;
        }
        return (
          <div key={m.id} style={{
            ...base,
            background: nameToColor(m.name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.round(pos.size * 0.42), fontWeight: 700, color: 'white',
          }}>
            {(m.name || '')[0]?.toUpperCase()}
          </div>
        );
      })}
    </div>
  );
}

function useAppSettings() {
  const [settings, setSettings] = useState({ app_name: 'rosterchirp', logo_url: '', color_avatar_public: '', color_avatar_dm: '' });
  const fetchSettings = () => {
    api.getSettings().then(({ settings }) => setSettings(settings)).catch(() => {});
  };
  useEffect(() => {
    fetchSettings();
    window.addEventListener('rosterchirp:settings-changed', fetchSettings);
    return () => window.removeEventListener('rosterchirp:settings-changed', fetchSettings);
  }, []);
  useEffect(() => {
    const name = settings.app_name || 'rosterchirp';
    const prefix = document.title.match(/^(\(\d+\)\s*)/)?.[1] || '';
    document.title = prefix + name;
    const faviconUrl = settings.logo_url || '/icons/rosterchirp.png';
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = faviconUrl;
  }, [settings]);
  return settings;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = parseTS(dateStr);
  const now = new Date();
  const diff = now - date;
  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 604800000) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Sidebar({ groups, activeGroupId, onSelectGroup, notifications, unreadGroups = new Map(), onNewChat, onProfile, onUsers, onSettings: onOpenSettings, onBranding, onGroupManager, onGroupsUpdated, isMobile, onAbout, onHelp, onlineUserIds = new Set(), features = {}, groupMessagesMode = false }) {
  const { user } = useAuth();
  const { connected } = useSocket();
  const toast = useToast();
  const settings = useAppSettings();

  const msgPublic       = features.msgPublic       ?? true;
  const msgU2U          = features.msgU2U          ?? true;
  const msgPrivateGroup = features.msgPrivateGroup ?? true;
  const loginType       = features.loginType       || 'all_ages';
  const playersGroupId  = features.playersGroupId  ?? null;

  const allGroups = [
    ...(groups.publicGroups || []),
    ...(groups.privateGroups || [])
  ];

  const publicFiltered = allGroups.filter(g => g.type === 'public');

  // In groupMessagesMode show only managed groups; on main Messages hide managed groups.
  // Also filter individual groups based on message feature flags.
  const privateFiltered = [...allGroups.filter(g => {
    if (g.type !== 'private') return false;
    if (groupMessagesMode) return g.is_managed;
    if (g.is_managed) return false;
    if (g.is_direct && !msgU2U) return false;
    if (!g.is_direct && !msgPrivateGroup) return false;
    // Guardian Only: hide the managed DM channel for the designated players group
    if (loginType === 'guardian_only' && g.is_managed && playersGroupId && g.source_user_group_id === playersGroupId) return false;
    return true;
  })].sort((a, b) => {
    if (!a.last_message_at && !b.last_message_at) return 0;
    if (!a.last_message_at) return 1;
    if (!b.last_message_at) return -1;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  const getNotifCount = (groupId) => notifications.filter(n => n.groupId === groupId).length;

  const GroupItem = ({ group }) => {
    const notifs = getNotifCount(group.id);
    const unreadCount = unreadGroups.get(group.id) || 0;
    const hasUnread = unreadCount > 0;
    const isActive = group.id === activeGroupId;
    const isOnline = !!group.is_direct && !!group.peer_id && (onlineUserIds instanceof Set ? onlineUserIds.has(Number(group.peer_id)) : false);

    // Peer avatar colour: use the same algorithm as Avatar.jsx so it matches message bubbles
    const peerColor = group.is_direct && !group.is_managed && group.peer_real_name
      ? nameToColor(group.peer_real_name)
      : null;

    return (
      <div
        className={`group-item ${isActive ? 'active' : ''} ${hasUnread ? 'has-unread' : ''}`}
        onClick={() => onSelectGroup(group.id)}
      >
        <div className="group-icon-wrap">
          {group.is_direct && group.peer_avatar && !group.is_managed ? (
            <img src={group.peer_avatar} alt={group.name} className="group-icon" style={{ objectFit: 'cover', padding: 0 }} />
          ) : group.is_direct && !group.is_managed ? (
            // No custom avatar — use the per-user colour matching Avatar.jsx
            <div className="group-icon" style={{ background: peerColor }}>
              {(group.peer_real_name || group.name)[0]?.toUpperCase()}
            </div>
          ) : group.is_managed && group.is_multi_group ? (
            <div className="group-icon" style={{ background: settings.color_avatar_dm || '#a142f4', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>MG</div>
          ) : group.is_managed ? (
            <div className="group-icon" style={{ background: settings.color_avatar_dm || '#a142f4', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>UG</div>
          ) : group.composite_members?.length > 0 ? (
            <GroupAvatarComposite memberPreviews={group.composite_members} />
          ) : (
            <div className="group-icon" style={{ background: group.type === 'public' ? (settings.color_avatar_public || '#1a73e8') : (settings.color_avatar_dm || '#a142f4') }}>
              {group.type === 'public' ? '#' : group.name[0]?.toUpperCase()}
            </div>
          )}
          {isOnline && <span className="online-dot" />}
        </div>
        <div className="group-info flex-1 overflow-hidden">
          <div className="flex items-center justify-between">
            <span className={`group-name truncate ${hasUnread ? 'unread-name' : ''}`}>
              {group.is_direct && group.peer_display_name
                ? <>{group.peer_display_name}<span className="dm-real-name"> ({group.peer_real_name})</span></>
                : group.is_direct && group.peer_real_name ? group.peer_real_name : group.name}
            </span>
            {group.last_message_at && (
              <span className="group-time">{formatTime(group.last_message_at)}</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="group-last-msg truncate">
              {(() => {
                const preview = (group.last_message || '').replace(/@\[([^\]]+)\]/g, '@$1');
                if (!preview) return group.is_readonly ? '📢 Read-only' : 'No messages yet';
                const isOwn = group.last_message_user_id && user && group.last_message_user_id === user.id;
                return isOwn ? <><strong style={{ fontWeight: 600 }}>You:</strong> {preview}</> : preview;
              })()}
            </span>
            {notifs > 0 && <span className="badge shrink-0">{notifs}</span>}
            {hasUnread && notifs === 0 && <span className="badge badge-unread shrink-0">{unreadCount}</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="sidebar">
      <div className="sidebar-newchat-bar">
        {!isMobile && (
          <button className="newchat-btn" onClick={onNewChat}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
            </svg>
            New Chat
          </button>
        )}
      </div>

      <div className="groups-list">
        {!groupMessagesMode && msgPublic && publicFiltered.length > 0 && (
          <div className="group-section">
            <div className="section-label">PUBLIC MESSAGES</div>
            {publicFiltered.map(g => <GroupItem key={g.id} group={g} />)}
          </div>
        )}
        {!groupMessagesMode && privateFiltered.length > 0 && (
          <div className="group-section">
            <div className="section-label">PRIVATE MESSAGES</div>
            {privateFiltered.map(g => <GroupItem key={g.id} group={g} />)}
          </div>
        )}
        {groupMessagesMode && privateFiltered.length > 0 && (
          <div className="group-section">
            <div className="section-label">USER GROUP MESSAGES</div>
            {privateFiltered.map(g => <GroupItem key={g.id} group={g} />)}
          </div>
        )}
        {groupMessagesMode && privateFiltered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)', fontSize: 14 }}>
            No group messages yet
          </div>
        )}
        {!groupMessagesMode && allGroups.filter(g => !g.is_managed || g.type === 'public').length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)', fontSize: 14 }}>
            No chats yet
          </div>
        )}
      </div>

      {isMobile && (
        <button className="newchat-fab" onClick={onNewChat} title="New Chat">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="24" height="24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
        </button>
      )}

      <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
    </div>
  );
}
