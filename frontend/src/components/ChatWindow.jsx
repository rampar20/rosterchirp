import { useState, useEffect, useRef, useCallback } from 'react';
import Message from './Message.jsx';
import MessageInput from './MessageInput.jsx';
import { api } from '../utils/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useSocket } from '../contexts/SocketContext.jsx';
import './ChatWindow.css';
import GroupInfoModal from './GroupInfoModal.jsx';

// Must match Avatar.jsx and Sidebar.jsx exactly so header colours are consistent with message avatars
const AVATAR_COLORS = ['#1a73e8','#ea4335','#34a853','#fa7b17','#a142f4','#00897b','#e91e8c','#0097a7'];
function nameToColor(name) {
  return AVATAR_COLORS[(name || '').charCodeAt(0) % AVATAR_COLORS.length];
}

// Composite avatar layouts for the 40×40 chat header icon
const COMPOSITE_LAYOUTS_SM = {
  1: [{ top: 4, left: 4, size: 32 }],
  2: [
    { top: 10, left: 1, size: 19 },
    { top: 10, right: 1, size: 19 },
  ],
  3: [
    { top: 2, left: 2, size: 17 },
    { top: 2, right: 2, size: 17 },
    { bottom: 2, left: 11, size: 17 },
  ],
  4: [
    { top: 1, left: 1, size: 18 },
    { top: 1, right: 1, size: 18 },
    { bottom: 1, left: 1, size: 18 },
    { bottom: 1, right: 1, size: 18 },
  ],
};

function GroupAvatarCompositeSm({ memberPreviews }) {
  const members = (memberPreviews || []).slice(0, 4);
  const positions = COMPOSITE_LAYOUTS_SM[members.length];
  if (!positions) return null;
  return (
    <div className="group-icon-sm" style={{ background: 'transparent', position: 'relative', padding: 0, overflow: 'visible' }}>
      {members.map((m, i) => {
        const pos = positions[i];
        const base = {
          position: 'absolute',
          width: pos.size, height: pos.size,
          borderRadius: '50%',
          boxSizing: 'border-box',
          border: '2px solid var(--surface)',
          ...(pos.top    !== undefined ? { top:    pos.top    } : {}),
          ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
          ...(pos.left   !== undefined ? { left:   pos.left   } : {}),
          ...(pos.right  !== undefined ? { right:  pos.right  } : {}),
          overflow: 'hidden', flexShrink: 0,
        };
        if (m.avatar) return <img key={m.id} src={m.avatar} alt={m.name} style={{ ...base, objectFit: 'cover' }} />;
        return (
          <div key={m.id} style={{ ...base, background: nameToColor(m.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(pos.size * 0.42), fontWeight: 700, color: 'white' }}>
            {(m.name || '')[0]?.toUpperCase()}
          </div>
        );
      })}
    </div>
  );
}

export default function ChatWindow({ group, onBack, onGroupUpdated, onDirectMessage, onMessageDeleted, onHasTextChange, onlineUserIds = new Set() }) {
  const { user: currentUser } = useAuth();
  const { socket } = useSocket();
  const { toast } = useToast();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typing, setTyping] = useState([]);
  const [iconGroupInfo, setIconGroupInfo] = useState('');
  const [avatarColors, setAvatarColors] = useState({ public: '#1a73e8', dm: '#a142f4' });
  const [showInfo, setShowInfo] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimers = useRef({});

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // On mobile, when the soft keyboard opens the visual viewport shrinks but the
  // messages-container scroll position stays where it was, leaving the latest
  // messages hidden behind the keyboard.  Scroll to bottom whenever the visual
  // viewport resizes (keyboard appear/dismiss) so the last message stays visible.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onVVResize = () => scrollToBottom();
    vv.addEventListener('resize', onVVResize);
    return () => vv.removeEventListener('resize', onVVResize);
  }, [scrollToBottom]);

  useEffect(() => {
    api.getSettings().then(({ settings }) => {
      setIconGroupInfo(settings.icon_groupinfo || '');
      setAvatarColors({ public: settings.color_avatar_public || '#1a73e8', dm: settings.color_avatar_dm || '#a142f4' });
    }).catch(() => {});
    const handler = () => api.getSettings().then(({ settings }) => {
      setIconGroupInfo(settings.icon_groupinfo || '');
      setAvatarColors({ public: settings.color_avatar_public || '#1a73e8', dm: settings.color_avatar_dm || '#a142f4' });
    }).catch(() => {});
    window.addEventListener('rosterchirp:settings-updated', handler);
    window.addEventListener('rosterchirp:settings-changed', handler);
    return () => {
      window.removeEventListener('rosterchirp:settings-updated', handler);
      window.removeEventListener('rosterchirp:settings-changed', handler);
    };
  }, []);

  useEffect(() => {
    if (!group) { setMessages([]); return; }
    setMessages([]);
    setHasMore(false);
    setLoading(true);
    api.getMessages(group.id)
      .then(({ messages }) => {
        setMessages(messages);
        setHasMore(messages.length >= 50);
        setTimeout(() => scrollToBottom(), 50);
      })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [group?.id]);

  // Socket events
  useEffect(() => {
    if (!socket || !group) return;

    const handleNew = (msg) => {
      if (msg.group_id !== group.id) return;
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setTimeout(() => scrollToBottom(true), 50);
    };

    const handleDeleted = ({ messageId, groupId }) => {
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === messageId ? { ...m, is_deleted: 1, content: null, image_url: null } : m
        );
        // Notify Chat.jsx so the sidebar preview updates immediately — pass the
        // post-delete messages so it can derive the new last non-deleted message
        // without an extra API call.
        onMessageDeleted?.({ groupId, messages: updated });
        return updated;
      });
    };

    const handleReaction = ({ messageId, reactions }) => {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, reactions } : m
      ));
    };

    const handleTypingStart = ({ userId: tid, user: tu }) => {
      if (tid === currentUser?.id) return;
      setTyping(prev => prev.find(t => t.userId === tid)
        ? prev
        : [...prev, { userId: tid, name: tu?.display_name || tu?.name || 'Someone' }]);
      if (typingTimers.current[tid]) clearTimeout(typingTimers.current[tid]);
      typingTimers.current[tid] = setTimeout(() => {
        setTyping(prev => prev.filter(t => t.userId !== tid));
      }, 4000);
    };

    const handleTypingStop = ({ userId: tid }) => {
      clearTimeout(typingTimers.current[tid]);
      setTyping(prev => prev.filter(t => t.userId !== tid));
    };

    const handleGroupUpdated = (updatedGroup) => {
      if (updatedGroup.id === group.id) onGroupUpdated?.();
    };

    socket.on('message:new', handleNew);
    socket.on('message:deleted', handleDeleted);
    socket.on('reaction:updated', handleReaction);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    socket.on('group:updated', handleGroupUpdated);

    return () => {
      socket.off('message:new', handleNew);
      socket.off('message:deleted', handleDeleted);
      socket.off('reaction:updated', handleReaction);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
      socket.off('group:updated', handleGroupUpdated);
    };
  }, [socket, group?.id, currentUser?.id]);

  const handleLoadMore = async () => {
    if (!hasMore || loading || messages.length === 0) return;
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    setLoading(true);
    try {
      const oldest = messages[0];
      const { messages: older } = await api.getMessages(group.id, oldest.id);
      setMessages(prev => [...older, ...prev]);
      setHasMore(older.length >= 50);
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - prevScrollHeight;
      });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async ({ content, imageFile, linkPreview, emojiOnly }) => {
    if ((!content?.trim() && !imageFile) || !group) return;
    const replyToId = replyTo?.id || null;
    setReplyTo(null);
    try {
      if (imageFile) {
        await api.uploadImage(group.id, imageFile, { replyToId, content: content?.trim() || '' });
      } else {
        await api.sendMessage(group.id, { content: content.trim(), replyToId, linkPreview, emojiOnly });
      }
    } catch (e) {
      toast(e.message || 'Failed to send', 'error');
    }
  };

  const handleDelete = async (msgId) => {
    try {
      await api.deleteMessage(msgId);
    } catch (e) {
      toast(e.message || 'Could not delete', 'error');
    }
  };

  const handleReact = async (msgId, emoji) => {
    try {
      await api.toggleReaction(msgId, emoji);
    } catch (e) {
      toast(e.message || 'Could not react', 'error');
    }
  };

  const handleReply = (msg) => {
    setReplyTo(msg);
  };

  const handleDirectMessage = (dmGroup) => {
    onDirectMessage?.(dmGroup);
  };

  if (!group) {
    return (
      <div className="chat-window empty">
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
            </svg>
          </div>
          <h3>Select a conversation</h3>
          <p>Choose a channel or direct message to start chatting</p>
        </div>
      </div>
    );
  }

  const isDirect = !!group.is_direct;
  const peerName = group.peer_display_name
    ? <>{group.peer_display_name}<span className="chat-header-real-name"> ({group.peer_real_name})</span></>
    : group.peer_real_name || group.name;
  const isOnline = isDirect && group.peer_id && (onlineUserIds instanceof Set ? onlineUserIds.has(Number(group.peer_id)) : false);

  return (
    <>
    <div className="chat-window">
      {/* Header */}
      <div className="chat-header">
        {isMobile && onBack && (
          <button className="btn-icon" onClick={onBack} style={{ marginRight: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}

        {isDirect && group.peer_avatar && !group.is_managed ? (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <img src={group.peer_avatar} alt={group.name} className="group-icon-sm" style={{ objectFit: 'cover', padding: 0 }} />
            {isOnline && <span className="online-dot" style={{ position: 'absolute', bottom: 1, right: 1 }} />}
          </div>
        ) : isDirect && !group.is_managed ? (
          // No custom avatar — use same per-user colour as Avatar.jsx and Sidebar.jsx
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div className="group-icon-sm" style={{ background: nameToColor(group.peer_real_name || group.name), flexShrink: 0 }}>
              {(group.peer_real_name || group.name)[0]?.toUpperCase()}
            </div>
            {isOnline && <span className="online-dot" style={{ position: 'absolute', bottom: 1, right: 1 }} />}
          </div>
        ) : group.is_managed ? (
          <div className="group-icon-sm" style={{ background: avatarColors.dm, borderRadius: 8, flexShrink: 0, fontSize: 11, fontWeight: 700 }}>
            {group.is_multi_group ? 'MG' : 'UG'}
          </div>
        ) : group.composite_members?.length > 0 ? (
          <GroupAvatarCompositeSm memberPreviews={group.composite_members} />
        ) : (
          <div className="group-icon-sm" style={{ background: group.type === 'public' ? avatarColors.public : avatarColors.dm, flexShrink: 0 }}>
            {group.type === 'public' ? '#' : group.name[0]?.toUpperCase()}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          <div className="chat-header-name truncate">
            {isDirect ? peerName : group.name}
            {group.is_readonly ? <span className="readonly-badge" style={{ marginLeft: 8 }}>read-only</span> : null}
          </div>
          {isDirect && <div className="chat-header-sub">Private message</div>}
          {!isDirect && group.type === 'public' && <div className="chat-header-sub">Public message</div>}
          {!isDirect && group.type === 'private' && group.is_managed && !group.is_multi_group && <div className="chat-header-sub">Private user group</div>}
          {!isDirect && group.type === 'private' && group.is_managed && group.is_multi_group && <div className="chat-header-sub">Private group</div>}
          {!isDirect && group.type === 'private' && !group.is_managed && <div className="chat-header-sub">Private group</div>}
        </div>

        <button
          className="btn-icon"
          onClick={() => setShowInfo(true)}
          title="Conversation info"
        >
          {iconGroupInfo ? (
            <img src={iconGroupInfo} alt="info" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" width="22" height="22">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" />
            </svg>
          )}
        </button>
      </div>

      {/* Messages */}
      <div className="messages-container" ref={messagesContainerRef}>
        {hasMore && (
          <button className="load-more-btn" onClick={handleLoadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load older messages'}
          </button>
        )}

        {messages.map((msg, i) => {
          // Skip deleted entries when looking for the effective previous message.
          // Deleted messages render null, so they must not affect date separators
          // or avatar-grouping for the messages that follow them.
          let effectivePrev = null;
          for (let j = i - 1; j >= 0; j--) {
            if (!messages[j].is_deleted) { effectivePrev = messages[j]; break; }
          }
          return (
            <Message
              key={msg.id}
              message={msg}
              prevMessage={effectivePrev}
              currentUser={currentUser}
              onReply={handleReply}
              onDelete={handleDelete}
              onReact={handleReact}
              onDirectMessage={handleDirectMessage}
              isDirect={isDirect}
              onlineUserIds={onlineUserIds} />
          );
        })}

        {typing.length > 0 && (
          <div className="typing-indicator">
            <span>{typing.map(t => t.name).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing</span>
            <div className="dots"><span /><span /><span /></div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {group.is_readonly && currentUser?.role !== 'admin' ? (
        <div className="readonly-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          This channel is read-only
        </div>
      ) : (
        <MessageInput group={group} currentUser={currentUser} onSend={handleSend} socket={socket} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onTyping={(isTyping) => { if (socket && group) socket.emit(isTyping ? 'typing:start' : 'typing:stop', { groupId: group.id }); }} onTextChange={val => onHasTextChange?.(!!val.trim())} onInputFocus={() => scrollToBottom()} />
      )}
    </div>
      {showInfo && (
        <GroupInfoModal
          group={group}
          onClose={() => setShowInfo(false)}
          onUpdated={(updatedGroup) => { setShowInfo(false); onGroupUpdated && onGroupUpdated(updatedGroup); }}
          onBack={() => setShowInfo(false)} />
      )}
    </>
  );
}
