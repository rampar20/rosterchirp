import { useState, useRef, useEffect } from 'react';
import Avatar from './Avatar.jsx';
import UserProfilePopup from './UserProfilePopup.jsx';
import ImageLightbox from './ImageLightbox.jsx';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { parseTS } from '../utils/api.js';
import './Message.css';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function formatMsgContent(content) {
  if (!content) return '';
  // First handle @mentions
  let html = content.replace(/@\[([^\]]+)\]/g, (_, name) => `<span class="mention">@${name}</span>`);
  // Then linkify bare URLs (not already inside a tag)
  html = html.replace(/(https?:\/\/[^\s<>"]+)/g, (url) => {
    // Trim trailing punctuation that's unlikely to be part of the URL
    const trimmed = url.replace(/[.,!?;:)\]]+$/, '');
    const trailing = url.slice(trimmed.length);
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer" class="msg-link">${trimmed}</a>${trailing}`;
  });
  return html;
}


// Detect emoji-only messages for large rendering
function isEmojiOnly(str) {
  if (!str || str.length > 12) return false;
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F|\u200D|[\u{1F1E0}-\u{1F1FF}])+$/u;
  return emojiRegex.test(str.trim());
}

export default function Message({ message: msg, prevMessage, currentUser, onReply, onDelete, onReact, onDirectMessage, isDirect, onlineUserIds = new Set() }) {
  const [showActions, setShowActions] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const longPressTimer = useRef(null);
  const optionsMenuRef = useRef(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const wrapperRef = useRef(null);
  const pickerRef = useRef(null);
  const avatarRef = useRef(null);
  const [showProfile, setShowProfile] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [pickerOpensDown, setPickerOpensDown] = useState(false);

  const isOwn = msg.user_id === currentUser.id;
  const isDeleted = !!msg.is_deleted;
  const isSystem = msg.type === 'system';

  // These must be computed before any early returns that reference them
  const showDateSep = !prevMessage ||
    parseTS(msg.created_at).toDateString() !== parseTS(prevMessage.created_at).toDateString();

  const prevSameUser = !showDateSep && prevMessage &&
    prevMessage.user_id === msg.user_id &&
    prevMessage.type !== 'system' && msg.type !== 'system';

  const canDelete = !msg.is_deleted && (
    msg.user_id === currentUser.id ||
    currentUser.role === 'admin' ||
    msg.group_owner_id === currentUser.id
  );

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  // Close options menu on outside click
  useEffect(() => {
    if (!showOptionsMenu) return;
    const close = (e) => {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target)) {
        setShowOptionsMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [showOptionsMenu]);

  const handleReact = (emoji) => {
    onReact(msg.id, emoji);
    setShowEmojiPicker(false);
  };

  const handleCopy = () => {
    if (!msg.content) return;
    navigator.clipboard.writeText(msg.content).catch(() => {});
  };

  const handleTogglePicker = () => {
    if (!showEmojiPicker && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setPickerOpensDown(rect.top < 400);
    }
    setShowEmojiPicker(p => !p);
  };

  // Long press for mobile action menu (DMs only)
  const handleTouchStart = () => {
    if (!isDirect) return;
    longPressTimer.current = setTimeout(() => setShowOptionsMenu(true), 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  // Deleted messages are filtered out by ChatWindow, but guard here too
  if (isDeleted) return null;

  // System messages render as a simple centred notice
  if (isSystem) {
    return (
      <>
        {showDateSep && (
          <div className="date-separator"><span>{formatDate(msg.created_at)}</span></div>
        )}
        <div className="system-message">{msg.content}</div>
      </>
    );
  }

  const reactionMap = {};
  for (const r of (msg.reactions || [])) {
    if (!reactionMap[r.emoji]) reactionMap[r.emoji] = { count: 0, users: [], hasMe: false };
    reactionMap[r.emoji].count++;
    reactionMap[r.emoji].users.push(r.user_name);
    if (r.user_id === currentUser.id) reactionMap[r.emoji].hasMe = true;
  }

  const msgUser = {
    id: msg.user_id,
    name: msg.user_name,
    display_name: msg.user_display_name,
    avatar: msg.user_avatar,
    role: msg.user_role,
    status: msg.user_status,
    hide_admin_tag: msg.user_hide_admin_tag,
    about_me: msg.user_about_me,
    allow_dm: msg.user_allow_dm,
  };

  return (
    <>
      {showDateSep && (
        <div className="date-separator">
          <span>{formatDate(msg.created_at)}</span>
        </div>
      )}

      <div
        ref={wrapperRef}
        className={`message-wrapper ${isOwn ? 'own' : 'other'} ${prevSameUser ? 'grouped' : ''}`}
      >
        {!isOwn && !prevSameUser && (
          <div
            ref={avatarRef}
            style={{ position: 'relative', cursor: 'pointer', transition: 'box-shadow 0.15s', flexShrink: 0, borderRadius: '50%', display: 'inline-flex' }}
            onClick={() => setShowProfile(p => !p)}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
          >
            <Avatar user={msgUser} size="sm" className="msg-avatar" />
            {!!(onlineUserIds instanceof Set ? onlineUserIds.has(Number(msg.user_id)) : false) && (
              <span style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 9, height: 9, borderRadius: '50%',
                background: '#34a853', border: '2px solid var(--surface)',
                pointerEvents: 'none'
              }} />
            )}
          </div>
        )}
        {!isOwn && prevSameUser && <div className="avatar-spacer" />}

        <div className="message-body">
          {!isOwn && !prevSameUser && (
            <div className="msg-name">
              {msgUser.display_name || msgUser.name}
              {msgUser.role === 'admin' && !msgUser.hide_admin_tag && <span className="role-badge role-admin" style={{ marginLeft: 6 }}>Admin</span>}
              {msgUser.status !== 'active' && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>(inactive)</span>}
            </div>
          )}

          {/* Reply preview */}
          {msg.reply_to_id && (
            <div className="reply-preview">
              <div className="reply-bar" />
              <div>
                <div className="reply-name">{msg.reply_user_display_name || msg.reply_user_name}</div>
                <div className="reply-text">
                  {msg.reply_is_deleted ? <em style={{ color: 'var(--text-tertiary)' }}>Deleted message</em>
                    : msg.reply_image_url ? '📷 Image'
                    : msg.reply_content}
                </div>
              </div>
            </div>
          )}

          {/* Bubble + actions together so actions hover above bubble */}
          <div className="msg-bubble-wrap">
            <div className="msg-bubble-with-actions"
              onMouseEnter={() => setShowActions(true)}
              onMouseLeave={() => { if (!showEmojiPicker && !showOptionsMenu) setShowActions(false); }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchEnd}
              onContextMenu={isDirect ? (e => { e.preventDefault(); setShowOptionsMenu(true); }) : undefined}
            >
              {/* Actions toolbar — floats above the bubble, aligned to correct side */}
              {!isDeleted && (showActions || showEmojiPicker) && (
                <div className={`msg-actions ${isOwn ? 'actions-left' : 'actions-right'}`}>
                  {QUICK_EMOJIS.map(e => (
                    <button key={e} className="quick-emoji" onClick={() => handleReact(e)} title={e}>{e}</button>
                  ))}
                  <button className="btn-icon action-btn" onClick={handleTogglePicker} title="More reactions">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                  </button>
                  <button className="btn-icon action-btn" onClick={() => onReply(msg)} title="Reply">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                  </button>
                  {msg.content && (
                    <button className="btn-icon action-btn" onClick={handleCopy} title="Copy text">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  )}
                  {canDelete && (
                    <button className="btn-icon action-btn danger" onClick={() => onDelete(msg.id)} title="Delete">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  )}

                  {/* Emoji picker anchored to the toolbar */}
                  {showEmojiPicker && (
                    <div
                      className={`emoji-picker-wrap ${isOwn ? 'picker-left' : 'picker-right'} ${pickerOpensDown ? 'picker-down' : ''}`}
                      ref={pickerRef}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      <Picker data={data} onEmojiSelect={(e) => handleReact(e.native)} theme="light" previewPosition="none" skinTonePosition="none" />
                    </div>
                  )}
                </div>
              )}

              <div className={`msg-bubble ${isOwn ? 'out' : 'in'}${!msg.image_url && isEmojiOnly(msg.content) ? ' emoji-only' : ''}`}>
                {msg.image_url && (
                  <img
                    src={msg.image_url}
                    alt="attachment"
                    className="msg-image"
                    onClick={() => setLightboxSrc(msg.image_url)} />
                )}
                {msg.content && (
                  isEmojiOnly(msg.content) && !msg.image_url
                    ? <p className="msg-text emoji-msg">{msg.content}</p>
                    : <p
                        className="msg-text"
                        dangerouslySetInnerHTML={{ __html: formatMsgContent(msg.content) }} />
                )}
                {msg.link_preview && <LinkPreview data={msg.link_preview} />}
              </div>
            </div>

            <span className="msg-time">{formatTime(msg.created_at)}</span>


          </div>

          {Object.keys(reactionMap).length > 0 && (
            <div className="reactions">
              {Object.entries(reactionMap).map(([emoji, { count, users, hasMe }]) => (
                <button
                  key={emoji}
                  className={`reaction-btn ${hasMe ? 'active' : ''}`}
                  onClick={() => onReact(msg.id, emoji)}
                  title={hasMe ? `${users.join(', ')} · Click to remove` : users.join(', ')}
                >
                  {emoji} <span className="reaction-count">{count}</span>
                  {hasMe && <span className="reaction-remove" title="Remove reaction">×</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showProfile && (
        <UserProfilePopup
          user={msgUser}
          anchorEl={avatarRef.current}
          onClose={() => setShowProfile(false)}
          onDirectMessage={onDirectMessage} />
      )}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  );
}

function LinkPreview({ data: raw }) {
  let d;
  try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!d?.title) return null;

  return (
    <a href={d.url} target="_blank" rel="noopener noreferrer" className="link-preview">
      {d.image && <img src={d.image} alt="" className="link-preview-img" onError={e => e.target.style.display = 'none'} />}
      <div className="link-preview-content">
        {d.siteName && <span className="link-site">{d.siteName}</span>}
        <span className="link-title">{d.title}</span>
        {d.description && <span className="link-desc">{d.description}</span>}
      </div>
    </a>
  );
}

function formatTime(dateStr) {
  return parseTS(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = parseTS(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
