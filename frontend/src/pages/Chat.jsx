import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../utils/api.js';
import Sidebar from '../components/Sidebar.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
import ProfileModal from '../components/ProfileModal.jsx';
import UserManagerPage from './UserManagerPage.jsx';
import GroupManagerPage from './GroupManagerPage.jsx';
import HostPanel from '../components/HostPanel.jsx';
import SettingsModal from '../components/SettingsModal.jsx';
import BrandingModal from '../components/BrandingModal.jsx';
import NewChatModal from '../components/NewChatModal.jsx';
import GlobalBar from '../components/GlobalBar.jsx';
import AboutModal from '../components/AboutModal.jsx';
import HelpModal from '../components/HelpModal.jsx';
import NavDrawer from '../components/NavDrawer.jsx';
import AddChildAliasModal from '../components/AddChildAliasModal.jsx';
import SchedulePage from '../components/SchedulePage.jsx';
import MobileGroupManager from '../components/MobileGroupManager.jsx';
import './Chat.css';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function Chat() {
  const { socket } = useSocket();
  const { user } = useAuth();
  const toast = useToast();

  const [groups, setGroups] = useState({ publicGroups: [], privateGroups: [] });
  // Ref so visibility/reconnect handlers always see the latest groups without
  // being dependencies of the socket effect (which would cause excessive re-runs)
  const groupsRef = useRef({ publicGroups: [], privateGroups: [] });
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [chatHasText, setChatHasText] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadGroups, setUnreadGroups] = useState(new Map());
  const [modal, setModal] = useState(null); // 'profile' | 'users' | 'settings' | 'newchat' | 'help' | 'groupmanager'
  const [page, setPage] = useState('chat'); // 'chat' | 'schedule' | 'groupmessages'
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [features, setFeatures] = useState({ branding: false, groupManager: false, scheduleManager: false, appType: 'RosterChirp-Chat', teamToolManagers: [], isHostDomain: false, msgPublic: true, msgGroup: true, msgPrivateGroup: true, msgU2U: true });
  const [helpDismissed, setHelpDismissed] = useState(true); // true until status loaded
  const [addChildPending, setAddChildPending] = useState(false); // defer add-child popup until help closes
  const addChildCheckedRef = useRef(false); // only auto-check aliases once per session
  const modalRef = useRef(null); // always reflects current modal value in async callbacks
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showSidebar, setShowSidebar] = useState(true);

  // Check if help should be shown on login
  useEffect(() => {
    api.getHelpStatus()
      .then(({ dismissed }) => {
        setHelpDismissed(dismissed);
        if (!dismissed) setModal('help');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handle = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setShowSidebar(true);
    };
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const loadGroups = useCallback(() => {
    api.getGroups().then(setGroups).catch(() => {});
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // Keep groupsRef in sync so visibility/reconnect handlers can read current groups
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // Load feature flags + current user's group memberships on mount (combined for consistent inGuardiansGroup)
  const loadFeatures = useCallback(() => {
    Promise.all([api.getSettings(), api.getMyUserGroups()])
      .then(([{ settings: s }, { userGroups }]) => {
        const memberships     = (userGroups || []).map(g => g.id);
        const guardiansGroupId = s.feature_guardians_group_id ? parseInt(s.feature_guardians_group_id) : null;
        setFeatures(prev => ({
          ...prev,
          branding:             s.feature_branding          === 'true',
          groupManager:         s.feature_group_manager     === 'true',
          scheduleManager:      s.feature_schedule_manager  === 'true',
          appType:              s.app_type || 'RosterChirp-Chat',
          teamToolManagers:     JSON.parse(s.team_tool_managers || s.team_group_managers || '[]'),
          isHostDomain:         s.is_host_domain === 'true',
          msgPublic:            s.feature_msg_public        !== 'false',
          msgGroup:             s.feature_msg_group         !== 'false',
          msgPrivateGroup:      s.feature_msg_private_group !== 'false',
          msgU2U:               s.feature_msg_u2u           !== 'false',
          loginType:            s.feature_login_type        || 'all_ages',
          playersGroupId:       s.feature_players_group_id  ? parseInt(s.feature_players_group_id) : null,
          guardiansGroupId,
          userGroupMemberships: memberships,
          inGuardiansGroup:     guardiansGroupId ? memberships.includes(guardiansGroupId) : false,
        }));
      }).catch(() => {});
  }, []);

  useEffect(() => {
    loadFeatures();
    window.addEventListener('rosterchirp:settings-changed', loadFeatures);
    return () => window.removeEventListener('rosterchirp:settings-changed', loadFeatures);
  }, [loadFeatures]);

  // Keep modalRef in sync so async callbacks can read current modal without stale closure
  useEffect(() => { modalRef.current = modal; }, [modal]);

  // Auto-popup Add Child Alias modal when guardian user has no children yet
  useEffect(() => {
    if (addChildCheckedRef.current) return;
    if (!features.inGuardiansGroup) return;
    if (features.loginType !== 'guardian_only' && features.loginType !== 'mixed_age') return;
    addChildCheckedRef.current = true;
    api.getAliases().then(({ aliases }) => {
      if (!(aliases || []).length) {
        if (modalRef.current === 'help') {
          setAddChildPending(true); // defer until help closes
        } else if (!modalRef.current) {
          setModal('addchild');
        }
      }
    }).catch(() => {});
  }, [features.loginType, features.inGuardiansGroup]);

  // Close help — open deferred add-child popup if pending, or settings for first-time default admin
  const handleHelpClose = useCallback(() => {
    if (addChildPending) {
      setAddChildPending(false);
      setModal('addchild');
    } else if (!helpDismissed && user?.is_default_admin && !localStorage.getItem('rosterchirp_admin_setup_shown')) {
      localStorage.setItem('rosterchirp_admin_setup_shown', '1');
      setModal('settings');
    } else {
      setModal(null);
    }
  }, [addChildPending, helpDismissed, user]);

  // Register / refresh push subscription — FCM for Android/Chrome, Web Push for iOS
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Convert a URL-safe base64 string to Uint8Array for the VAPID applicationServerKey
    function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw     = atob(base64);
      return Uint8Array.from(raw, c => c.charCodeAt(0));
    }

    // ── iOS / Web Push path ───────────────────────────────────────────────────
    // iOS 16.4+ PWAs use the standard W3C Web Push API via pushManager.subscribe().
    // FCM tokens are Google-specific and are not accepted by Apple's push service.
    const registerWebPush = async () => {
      try {
        const configRes = await fetch('/api/push/vapid-public-key');
        if (!configRes.ok) { console.warn('[Push] VAPID key not available'); return; }
        const { vapidPublicKey } = await configRes.json();

        const reg = await navigator.serviceWorker.ready;

        // Re-use any existing subscription so we don't lose it on every page load
        let subscription = await reg.pushManager.getSubscription();
        if (subscription) {
          // Check if it's already registered with the server
          const cachedEndpoint = localStorage.getItem('rc_webpush_endpoint');
          if (cachedEndpoint === subscription.endpoint) {
            console.log('[Push] WebPush subscription unchanged — skipping subscribe');
            return;
          }
        } else {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
        }

        console.log('[Push] WebPush subscription obtained');
        const subJson = subscription.toJSON();
        const token = localStorage.getItem('tc_token') || sessionStorage.getItem('tc_token');
        const subRes = await fetch('/api/push/subscribe-webpush', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
        });
        if (!subRes.ok) {
          const err = await subRes.json().catch(() => ({}));
          console.warn('[Push] WebPush subscribe failed:', err.error || subRes.status);
          localStorage.setItem('rc_fcm_error', `WebPush subscribe failed: ${err.error || subRes.status}`);
        } else {
          localStorage.setItem('rc_webpush_endpoint', subJson.endpoint);
          localStorage.removeItem('rc_fcm_error');
          console.log('[Push] WebPush subscription registered successfully');
        }
      } catch (e) {
        console.warn('[Push] WebPush registration failed:', e.message);
        localStorage.setItem('rc_fcm_error', e.message);
      }
    };

    // ── Android / Chrome FCM path ─────────────────────────────────────────────
    const registerFCM = async () => {
      try {
        // Fetch Firebase config from backend (returns 503 if FCM not configured)
        const configRes = await fetch('/api/push/firebase-config');
        if (!configRes.ok) return;
        const { apiKey, projectId, messagingSenderId, appId, vapidKey } = await configRes.json();

        // Dynamically import the Firebase SDK (tree-shaken, only loaded when needed)
        const { initializeApp, getApps } = await import('firebase/app');
        const { getMessaging, getToken } = await import('firebase/messaging');

        const firebaseApp = getApps().length
          ? getApps()[0]
          : initializeApp({ apiKey, projectId, messagingSenderId, appId });
        const firebaseMessaging = getMessaging(firebaseApp);

        const reg = await navigator.serviceWorker.ready;

        // Do NOT call deleteToken() here. Deleting the token on every page load (or
        // every visibility-change) forces Chrome to create a new Web Push subscription
        // each time. During the brief window between delete and re-register the server
        // still holds the old (now invalid) token, so any in-flight message fails to
        // deliver. Passing serviceWorkerRegistration directly to getToken() is enough
        // for Firebase to return the existing valid token without needing a refresh.
        console.log('[Push] Requesting FCM token...');
        let fcmToken;
        try {
          fcmToken = await getToken(firebaseMessaging, {
            vapidKey,
            serviceWorkerRegistration: reg,
          });
        } catch (tokenErr) {
          const msg = tokenErr.message || 'getToken() threw an error';
          console.warn('[Push] getToken() threw:', msg);
          localStorage.setItem('rc_fcm_error', msg);
          return;
        }
        if (!fcmToken) {
          const msg = 'getToken() returned null — check VAPID key and OS notification permission';
          console.warn('[Push]', msg);
          localStorage.setItem('rc_fcm_error', msg);
          return;
        }
        console.log('[Push] FCM token obtained:', fcmToken.slice(0, 30) + '...');

        // Skip the server round-trip if this token is already registered.
        // Avoids a redundant DB write on every tab-focus / visibility change.
        const cachedToken = localStorage.getItem('rc_fcm_token');
        if (cachedToken === fcmToken) {
          console.log('[Push] Token unchanged — skipping subscribe');
          localStorage.removeItem('rc_fcm_error');
          return;
        }

        const token = localStorage.getItem('tc_token') || sessionStorage.getItem('tc_token');
        const subRes = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ fcmToken }),
        });
        if (!subRes.ok) {
          const err = await subRes.json().catch(() => ({}));
          const msg = `Subscribe failed: ${err.error || subRes.status}`;
          console.warn('[Push]', msg);
          localStorage.setItem('rc_fcm_error', msg);
        } else {
          localStorage.setItem('rc_fcm_token', fcmToken);
          localStorage.removeItem('rc_fcm_error');
          console.log('[Push] FCM subscription registered successfully');
        }
      } catch (e) {
        console.warn('[Push] FCM subscription failed:', e.message);
        localStorage.setItem('rc_fcm_error', e.message);
      }
    };

    const registerPush = async () => {
      try {
        if (Notification.permission === 'denied') return;
        // Never auto-request permission — that triggers a dialog on PWA launch.
        // Permission is requested explicitly from the Notifications tab in the profile modal.
        if (Notification.permission !== 'granted') return;
        // Respect the user's explicit opt-out from the user menu toggle
        if (localStorage.getItem('rc_push_enabled') === 'false') return;

        const isIOS = /iphone|ipad/i.test(navigator.userAgent);
        if (isIOS) {
          await registerWebPush();
        } else {
          await registerFCM();
        }
      } catch (e) {
        console.warn('[Push] registerPush failed:', e.message);
      }
    };

    registerPush();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') registerPush();
    };
    // When the user explicitly requests push (via the Notifications toggle or
    // re-register button), ask for permission if it hasn't been granted yet.
    const handlePushInit = async () => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result !== 'granted') return;
      }
      registerPush();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('rosterchirp:push-init', handlePushInit);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('rosterchirp:push-init', handlePushInit);
    };
  }, []);

  // When a message is deleted, update the sidebar preview immediately.
  // ChatWindow passes back the full post-delete messages array so we can derive
  // the new latest non-deleted message without an extra API call.
  const handleMessageDeleted = useCallback(({ groupId, messages: updatedMessages }) => {
    const latest = [...updatedMessages]
      .reverse()
      .find(m => !m.is_deleted);
    setGroups(prev => {
      const updateGroup = (g) => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          last_message:         latest ? (latest.content || (latest.image_url ? '📷 Image' : '')) : null,
          last_message_at:      latest ? latest.created_at : null,
          last_message_user_id: latest ? latest.user_id    : null,
        };
      };
      return {
        publicGroups:  prev.publicGroups.map(updateGroup),
        privateGroups: prev.privateGroups.map(updateGroup),
      };
    });
  }, []);

  // Socket message events to update group previews
  useEffect(() => {
    if (!socket) return;

    const handleNewMsg = (msg) => {
      // Update group preview text
      setGroups(prev => {
        const updateGroup = (g) => g.id === msg.group_id
          ? { ...g, last_message: msg.content || (msg.image_url ? '📷 Image' : ''), last_message_at: msg.created_at, last_message_user_id: msg.user_id }
          : g;
        const updatedPrivate = prev.privateGroups.map(updateGroup)
          .sort((a, b) => {
            if (!a.last_message_at && !b.last_message_at) return 0;
            if (!a.last_message_at) return 1;
            if (!b.last_message_at) return -1;
            return new Date(b.last_message_at) - new Date(a.last_message_at);
          });
        return {
          publicGroups: prev.publicGroups.map(updateGroup),
          privateGroups: updatedPrivate,
        };
      });
      // Don't badge own messages
      if (msg.user_id === user?.id) return;
      // Bug C fix: count unread even in the active group when window is hidden/minimized
      const groupIsActive = msg.group_id === activeGroupId;
      const windowHidden = document.visibilityState === 'hidden';
      setUnreadGroups(prev => {
        if (groupIsActive && !windowHidden) return prev; // visible & active: no badge
        const next = new Map(prev);
        next.set(msg.group_id, (next.get(msg.group_id) || 0) + 1);
        return next;
      });
    };

    const handleNotification = (notif) => {
      if (notif.type === 'private_message') {
        // Badge is already handled by handleNewMsg via message:new socket event.
        // Nothing to do here for the socket path.
      } else if (notif.type === 'support') {
        // A support request was submitted — reload groups so Support group appears in sidebar
        loadGroups();
      } else {
        setNotifications(prev => [notif, ...prev]);
        toast(`${notif.fromUser?.display_name || notif.fromUser?.name || 'Someone'} mentioned you`, 'default', 4000);
      }
    };

    socket.on('message:new', handleNewMsg);
    socket.on('notification:new', handleNotification);

    // Group list real-time updates
    const handleGroupNew = ({ group }) => {
      // Join the socket room for this new group
      socket.emit('group:join-room', { groupId: group.id });
      // Reload the full group list so name/metadata is correct
      loadGroups();
      // Refresh user-group memberships so NavDrawer shows the Group Messages
      // item immediately if this is the user's first user-group DM assignment
      api.getMyUserGroups().then(({ userGroups }) => {
        setFeatures(prev => ({ ...prev, userGroupMemberships: (userGroups || []).map(g => g.id) }));
      }).catch(() => {});
    };
    const handleGroupDeleted = ({ groupId }) => {
      // Leave the socket room so we stop receiving events for this group
      socket.emit('group:leave-room', { groupId });
      setGroups(prev => ({
        publicGroups: prev.publicGroups.filter(g => g.id !== groupId),
        privateGroups: prev.privateGroups.filter(g => g.id !== groupId),
      }));
      setActiveGroupId(prev => {
        if (prev === groupId) {
          if (isMobile) setShowSidebar(true);
          return null;
        }
        return prev;
      });
      setUnreadGroups(prev => { const next = new Map(prev); next.delete(groupId); return next; });
    };
    const handleGroupUpdated = ({ group }) => {
      setGroups(prev => {
        const update = g => g.id === group.id ? { ...g, ...group } : g;
        return {
          publicGroups: prev.publicGroups.map(update),
          privateGroups: prev.privateGroups.map(update),
        };
      });
      // When composite_members is updated, do a full reload so all members
      // get the enriched group data (including composite) immediately.
      if (group.composite_members != null) {
        loadGroups();
      }
    };

    // Session displaced: another login on the same device type kicked us out
    const handleSessionDisplaced = ({ device: displacedDevice }) => {
      // Only act if it's our device slot that was taken over
      // (The server emits to user room so all sockets of this user receive it;
      //  our socket's device is embedded in the socket but we can't read it here,
      //  so we force logout unconditionally — the new session will reconnect cleanly)
      localStorage.removeItem('tc_token');
      sessionStorage.removeItem('tc_token');
      window.dispatchEvent(new CustomEvent('rosterchirp:session-displaced'));
    };

    // Online presence
    const handleUserOnline = ({ userId }) => setOnlineUserIds(prev => new Set([...prev, Number(userId)]));
    const handleUserOffline = ({ userId }) => setOnlineUserIds(prev => { const n = new Set(prev); n.delete(Number(userId)); return n; });
    const handleUsersOnline = ({ userIds }) => setOnlineUserIds(new Set((userIds || []).map(Number)));

    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('users:online', handleUsersOnline);
    // Request current online list on connect
    socket.emit('users:online');

    socket.on('group:new', handleGroupNew);
    socket.on('group:deleted', handleGroupDeleted);
    socket.on('group:updated', handleGroupUpdated);
    socket.on('session:displaced', handleSessionDisplaced);

    // On reconnect or visibility restore: reload groups AND badge any groups that
    // received messages while the iOS PWA was backgrounded (socket was dead, so
    // message:new events were never received — only push notifications arrived).
    const checkForMissedMessages = () => {
      api.getGroups().then(newGroups => {
        const prev = groupsRef.current;
        setGroups(newGroups);
        const allPrev = [...prev.publicGroups, ...prev.privateGroups];
        const allNew  = [...newGroups.publicGroups, ...newGroups.privateGroups];
        setUnreadGroups(prevUnread => {
          const next = new Map(prevUnread);
          for (const ng of allNew) {
            if (ng.id === activeGroupId) continue;          // currently open — no badge
            if (ng.last_message_user_id === user?.id) continue; // own message
            const pg = allPrev.find(g => g.id === ng.id);
            const isNewer = ng.last_message_at && (
              !pg?.last_message_at ||
              new Date(ng.last_message_at) > new Date(pg.last_message_at)
            );
            if (isNewer && !next.has(ng.id)) {
              next.set(ng.id, 1);
            }
          }
          return next;
        });
      }).catch(() => {});
    };

    const handleReconnect = () => { checkForMissedMessages(); };
    socket.on('connect', handleReconnect);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && socket.connected) {
        checkForMissedMessages();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      socket.off('message:new', handleNewMsg);
      socket.off('notification:new', handleNotification);
      socket.off('group:new', handleGroupNew);
      socket.off('group:deleted', handleGroupDeleted);
      socket.off('group:updated', handleGroupUpdated);
      socket.off('user:online', handleUserOnline);
      socket.off('user:offline', handleUserOffline);
      socket.off('users:online', handleUsersOnline);
      socket.off('connect', handleReconnect);
      socket.off('session:displaced', handleSessionDisplaced);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [socket, toast, activeGroupId, user, isMobile, loadGroups]);

  const selectGroup = (id) => {
    // Warn if there's unsaved text in the message input and the user is switching conversations
    if (chatHasText && id !== activeGroupId) {
      const ok = window.confirm('You have unsaved text in the message box.\n\nContinue to discard it and open the new conversation, or Cancel to stay.');
      if (!ok) return;
      setChatHasText(false);
    }
    setActiveGroupId(id);
    if (isMobile) {
      setShowSidebar(false);
      // The mount sentinel covers the first back gesture — no extra push needed here
    }
    // Clear notifications and unread count for this group
    setNotifications(prev => prev.filter(n => n.groupId !== id));
    setUnreadGroups(prev => { const next = new Map(prev); next.delete(id); return next; });
  };

  // Establish two history entries on mount (mobile only):
  //   floor   — marks the true exit point; always stays below the sentinel
  //   sentinel — intercepted by handlePopState on every back gesture
  // Two entries are required so that iOS fires popstate (same-document navigation)
  // before exiting, giving the handler a chance to push a new sentinel.
  useEffect(() => {
    if (window.innerWidth < 768) {
      window.history.replaceState({ rc: 'floor' }, '');
      window.history.pushState({ rc: 'chat' }, '');
    }
  }, []);

  // Handle browser back gesture on mobile — step through the navigation hierarchy:
  //   chat open  →  list view for the current page  →  Messages  →  exit app
  useEffect(() => {
    const handlePopState = () => {
      if (!isMobile) return;

      if (activeGroupId) {
        // Close the open chat, stay on the current page's list (chat or groupmessages)
        setShowSidebar(true);
        setActiveGroupId(null);
        setChatHasText(false);
        window.history.pushState({ rc: 'chat' }, '');
        return;
      }

      if (page !== 'chat') {
        // On a secondary page (groupmessages / users / groups / schedule / hostpanel)
        // — return to the default Messages page
        setPage('chat');
        window.history.pushState({ rc: 'chat' }, '');
        return;
      }

      // Already at root (Messages list, no chat open) — we just popped the sentinel
      // and are now on the floor entry. Step one more back so the browser exits the
      // PWA (or navigates to the previous URL). Without this explicit go(-1), iOS
      // leaves the user stranded on the invisible floor state.
      window.history.go(-1);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMobile, activeGroupId, page]);

  // Update page title AND PWA app badge with total unread count
  useEffect(() => {
    const totalUnread = [...unreadGroups.values()].reduce((a, b) => a + b, 0);
    // Strip any existing badge prefix to get the clean base title
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base;
    // PWA app icon badge (Chrome/Edge desktop + Android, Safari 16.4+)
    if ('setAppBadge' in navigator) {
      if (totalUnread > 0) {
        navigator.setAppBadge(totalUnread).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }, [unreadGroups]);

  const activeGroup = [
    ...(groups.publicGroups || []),
    ...(groups.privateGroups || [])
  ].find(g => g.id === activeGroupId);

  const isToolManager = user?.role === 'admin' || user?.role === 'manager' || (features.teamToolManagers || []).some(gid => (features.userGroupMemberships || []).includes(gid));

  // Unread indicators for burger icon and nav drawer
  const allGroupsFlat = [...(groups.publicGroups || []), ...(groups.privateGroups || [])];
  const hasUnreadChat = allGroupsFlat.some(g =>
    (g.type === 'public' || !g.is_managed) && (unreadGroups.get(g.id) || 0) > 0
  );
  const hasUnreadGroupMessages = (groups.privateGroups || []).some(g =>
    g.is_managed && (unreadGroups.get(g.id) || 0) > 0
  );
  const hasAnyUnread = hasUnreadChat || hasUnreadGroupMessages;

  if (page === 'users') {
    return (
      <div className="chat-layout">
        <GlobalBar isMobile={isMobile} showSidebar={true} onBurger={() => setDrawerOpen(true)} hasUnread={hasAnyUnread} />
        <div className="chat-body" style={{ overflow: 'hidden' }}>
          <UserManagerPage isMobile={isMobile} onProfile={() => setModal('profile')} onHelp={() => setModal('help')} onAbout={() => setModal('about')} />
        </div>
        <NavDrawer
          open={drawerOpen} onClose={() => setDrawerOpen(false)}
          onMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('chat'); }}
          onGroupMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groupmessages'); }}
          onSchedule={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
          onGroupManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
          onBranding={() => { setDrawerOpen(false); setModal('branding'); }}
          onSettings={() => { setDrawerOpen(false); setModal('settings'); }}
          onUsers={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
          onHostPanel={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('hostpanel'); }}
          onAddChild={() => { setDrawerOpen(false); setModal('addchild'); }}
          features={features} currentPage={page} isMobile={isMobile}
          unreadMessages={hasUnreadChat} unreadGroupMessages={hasUnreadGroupMessages} />
        {modal === 'profile'  && <ProfileModal onClose={() => setModal(null)} />}
        {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} onFeaturesChanged={setFeatures} />}
        {modal === 'branding' && <BrandingModal onClose={() => setModal(null)} />}
        {modal === 'help'     && <HelpModal onClose={handleHelpClose} dismissed={helpDismissed} />}
        {modal === 'addchild' && <AddChildAliasModal features={features} onClose={() => setModal(null)} />}
        {modal === 'about'    && <AboutModal onClose={() => setModal(null)} />}

      </div>
    );
  }

  if (page === 'groups') {
    return (
      <div className="chat-layout">
        <GlobalBar isMobile={isMobile} showSidebar={true} onBurger={() => setDrawerOpen(true)} hasUnread={hasAnyUnread} />
        <div className="chat-body" style={{ overflow: 'hidden' }}>
          <GroupManagerPage isMobile={isMobile} onProfile={() => setModal('profile')} onHelp={() => setModal('help')} onAbout={() => setModal('about')} />
        </div>
        <NavDrawer
          open={drawerOpen} onClose={() => setDrawerOpen(false)}
          onMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('chat'); }}
          onGroupMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groupmessages'); }}
          onSchedule={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
          onGroupManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
          onBranding={() => { setDrawerOpen(false); setModal('branding'); }}
          onSettings={() => { setDrawerOpen(false); setModal('settings'); }}
          onUsers={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
          onHostPanel={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('hostpanel'); }}
          onAddChild={() => { setDrawerOpen(false); setModal('addchild'); }}
          features={features} currentPage={page} isMobile={isMobile}
          unreadMessages={hasUnreadChat} unreadGroupMessages={hasUnreadGroupMessages} />
        {modal === 'profile'  && <ProfileModal onClose={() => setModal(null)} />}
        {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} onFeaturesChanged={setFeatures} />}
        {modal === 'branding' && <BrandingModal onClose={() => setModal(null)} />}
        {modal === 'help'     && <HelpModal onClose={handleHelpClose} dismissed={helpDismissed} />}
        {modal === 'addchild' && <AddChildAliasModal features={features} onClose={() => setModal(null)} />}
        {modal === 'about'    && <AboutModal onClose={() => setModal(null)} />}

      </div>
    );
  }

  if (page === 'groupmessages') {
    return (
      <div className="chat-layout">
        <GlobalBar isMobile={isMobile} showSidebar={showSidebar} onBurger={() => setDrawerOpen(true)} hasUnread={hasAnyUnread} />
        <div className="chat-body">
          {(!isMobile || showSidebar) && (
            <Sidebar
              groups={groups}
              activeGroupId={activeGroupId}
              onSelectGroup={selectGroup}
              notifications={notifications}
              unreadGroups={unreadGroups}
              onNewChat={() => setModal('newchat')}
              onProfile={() => setModal('profile')}
              onUsers={() => { setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
              onSettings={() => setModal('settings')}
              onBranding={() => setModal('branding')}
              onGroupManager={() => { setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
              features={features}
              onGroupsUpdated={loadGroups}
              isMobile={isMobile}
              onAbout={() => setModal('about')}
              onHelp={() => setModal('help')}
              onlineUserIds={onlineUserIds}
              groupMessagesMode={true} />
          )}
          {(!isMobile || !showSidebar) && (
            <ChatWindow
              group={activeGroup}
              onBack={isMobile ? () => { setShowSidebar(true); setActiveGroupId(null); } : null}
              onGroupUpdated={loadGroups}
              onDirectMessage={(g) => { loadGroups(); selectGroup(g.id); }}
              onMessageDeleted={handleMessageDeleted}
              onHasTextChange={setChatHasText}
              onlineUserIds={onlineUserIds} />
          )}
        </div>
        <NavDrawer
          open={drawerOpen} onClose={() => setDrawerOpen(false)}
          onMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('chat'); }}
          onGroupMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groupmessages'); }}
          onSchedule={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
          onGroupManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
          onBranding={() => { setDrawerOpen(false); setModal('branding'); }}
          onSettings={() => { setDrawerOpen(false); setModal('settings'); }}
          onUsers={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
          onHostPanel={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('hostpanel'); }}
          onAddChild={() => { setDrawerOpen(false); setModal('addchild'); }}
          features={features} currentPage={page} isMobile={isMobile}
          unreadMessages={hasUnreadChat} unreadGroupMessages={hasUnreadGroupMessages} />
        {modal === 'profile'  && <ProfileModal onClose={() => setModal(null)} />}
        {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} onFeaturesChanged={setFeatures} />}
        {modal === 'branding' && <BrandingModal onClose={() => setModal(null)} />}
        {modal === 'help'     && <HelpModal onClose={handleHelpClose} dismissed={helpDismissed} />}
        {modal === 'addchild' && <AddChildAliasModal features={features} onClose={() => setModal(null)} />}
        {modal === 'about'    && <AboutModal onClose={() => setModal(null)} />}
        {modal === 'newchat'  && <NewChatModal features={features} onClose={() => setModal(null)} onCreated={(g) => { loadGroups(); setModal(null); setActiveGroupId(g.id); setPage('chat'); }} />}

      </div>
    );
  }

  if (page === 'hostpanel') {
    return (
      <div className="chat-layout">
        <GlobalBar isMobile={isMobile} showSidebar={true} onBurger={() => setDrawerOpen(true)} hasUnread={hasAnyUnread} />
        <div className="chat-body" style={{ overflow: 'hidden' }}>
          <HostPanel onProfile={() => setModal('profile')} onHelp={() => setModal('help')} onAbout={() => setModal('about')} />
        </div>
        <NavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('chat'); }}
          onGroupMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groupmessages'); }}
          onSchedule={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
          onScheduleManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
          onGroupManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
          onBranding={() => { setDrawerOpen(false); setModal('branding'); }}
          onSettings={() => { setDrawerOpen(false); setModal('settings'); }}
          onUsers={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
          onHostPanel={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('hostpanel'); }}
          onAddChild={() => { setDrawerOpen(false); setModal('addchild'); }}
          features={features}
          currentPage={page}
          isMobile={isMobile}
          unreadMessages={hasUnreadChat} unreadGroupMessages={hasUnreadGroupMessages} />
        {modal === 'profile'  && <ProfileModal onClose={() => setModal(null)} />}
        {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} onFeaturesChanged={setFeatures} />}
        {modal === 'branding' && <BrandingModal onClose={() => setModal(null)} />}
        {modal === 'help'     && <HelpModal onClose={handleHelpClose} dismissed={helpDismissed} />}
        {modal === 'addchild' && <AddChildAliasModal features={features} onClose={() => setModal(null)} />}
        {modal === 'about'    && <AboutModal onClose={() => setModal(null)} />}

      </div>
    );
  }

  if (page === 'schedule') {
    return (
      <div className="chat-layout">
        <GlobalBar isMobile={isMobile} showSidebar={true} onBurger={() => setDrawerOpen(true)} hasUnread={hasAnyUnread} />
        <div className="chat-body" style={{ overflow: 'hidden' }}>
          <SchedulePage
            isToolManager={isToolManager}
            isMobile={isMobile}
            features={features}
            onProfile={() => setModal('profile')}
            onHelp={() => setModal('help')}
            onAbout={() => setModal('about')} />
        </div>
        <NavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('chat'); }}
          onGroupMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groupmessages'); }}
          onSchedule={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
          onScheduleManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
          onGroupManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
          onBranding={() => { setDrawerOpen(false); setModal('branding'); }}
          onSettings={() => { setDrawerOpen(false); setModal('settings'); }}
          onUsers={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
          onHostPanel={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('hostpanel'); }}
          onAddChild={() => { setDrawerOpen(false); setModal('addchild'); }}
          features={features}
          currentPage={page}
          isMobile={isMobile}
          unreadMessages={hasUnreadChat} unreadGroupMessages={hasUnreadGroupMessages} />
        {modal === 'profile'      && <ProfileModal onClose={() => setModal(null)} />}
        {modal === 'settings'     && <SettingsModal onClose={() => setModal(null)} onFeaturesChanged={setFeatures} />}
        {modal === 'branding'     && <BrandingModal onClose={() => setModal(null)} />}

        {modal === 'mobilegroupmanager' && (
          <div style={{ position:'fixed',inset:0,zIndex:200,background:'var(--background)' }}>
            <MobileGroupManager onClose={() => setModal(null)}/>
          </div>
        )}
        {modal === 'about'        && <AboutModal onClose={() => setModal(null)} />}
        {modal === 'help'         && <HelpModal onClose={handleHelpClose} dismissed={helpDismissed} />}
        {modal === 'addchild'     && <AddChildAliasModal onClose={() => setModal(null)} />}

      </div>
    );
  }

  return (
    <div className="chat-layout">
      {/* Global top bar — spans full width on desktop, visible on mobile sidebar view */}
      <GlobalBar isMobile={isMobile} showSidebar={showSidebar} onBurger={() => setDrawerOpen(true)} hasUnread={hasAnyUnread} />

      <div className="chat-body">
        {(!isMobile || showSidebar) && (
          <Sidebar
            groups={groups}
            activeGroupId={activeGroupId}
            onSelectGroup={selectGroup}
            notifications={notifications}
            unreadGroups={unreadGroups}
            onNewChat={() => setModal('newchat')}
            onProfile={() => setModal('profile')}
            onUsers={() => { setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
            onSettings={() => setModal('settings')}
            onBranding={() => setModal('branding')}
            onGroupManager={() => { setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
            features={features}
            onGroupsUpdated={loadGroups}
            isMobile={isMobile}
            onAbout={() => setModal('about')}
            onHelp={() => setModal('help')}
            onlineUserIds={onlineUserIds}
            groupMessagesMode={false} />
        )}

        {(!isMobile || !showSidebar) && (
          <ChatWindow
            group={activeGroup}
            onBack={isMobile ? () => { setShowSidebar(true); setActiveGroupId(null); } : null}
            onGroupUpdated={loadGroups}
            onDirectMessage={(g) => { loadGroups(); selectGroup(g.id); }}
            onMessageDeleted={handleMessageDeleted}
            onHasTextChange={setChatHasText}
            onlineUserIds={onlineUserIds} />
        )}
      </div>

      <NavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('chat'); }}
        onGroupMessages={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groupmessages'); }}
        onSchedule={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
        onScheduleManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('schedule'); }}
        onGroupManager={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('groups'); }}
        onBranding={() => { setDrawerOpen(false); setModal('branding'); }}
        onSettings={() => { setDrawerOpen(false); setModal('settings'); }}
        onUsers={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('users'); }}
        onHostPanel={() => { setDrawerOpen(false); setActiveGroupId(null); setChatHasText(false); setPage('hostpanel'); }}
        onAddChild={() => { setDrawerOpen(false); setModal('addchild'); }}
        features={features}
        currentPage={page}
        isMobile={isMobile}
        unreadMessages={hasUnreadChat} unreadGroupMessages={hasUnreadGroupMessages} />
      {modal === 'profile' && <ProfileModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} onFeaturesChanged={setFeatures} />}
      {modal === 'branding' && <BrandingModal onClose={() => setModal(null)} />}

      {modal === 'newchat' && <NewChatModal features={features} onClose={() => setModal(null)} onCreated={(g) => { loadGroups(); setModal(null); setActiveGroupId(g.id); }} />}
      {modal === 'about' && <AboutModal onClose={() => setModal(null)} />}
      {modal === 'help' && <HelpModal onClose={handleHelpClose} dismissed={helpDismissed} />}
      {modal === 'addchild' && <AddChildAliasModal features={features} onClose={() => setModal(null)} />}
    </div>
  );
}
