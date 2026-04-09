import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../utils/api.js';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import './MessageInput.css';

const URL_REGEX = /https?:\/\/[^\s]+/g;

// Detect if a string is purely emoji characters (no other text)
function isEmojiOnly(str) {
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F|\u200D|[\u{1F1E0}-\u{1F1FF}])+$/u;
  return emojiRegex.test(str.trim());
}

export default function MessageInput({ group, replyTo, onCancelReply, onSend, onTyping, onTextChange, onInputFocus, onlineUserIds = new Set() }) {
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(-1);
  const [showMention, setShowMention] = useState(false);
  const [linkPreview, setLinkPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const wasTyping = useRef(false);
  const mentionStart = useRef(-1);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const attachMenuRef = useRef(null);
  const emojiPickerRef = useRef(null);

  // Close attach menu / emoji picker on outside click
  useEffect(() => {
    const handler = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setShowAttachMenu(false);
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset input state when switching to a different conversation
  useEffect(() => {
    setText('');
    setImageFile(null);
    setImagePreview(null);
    setLinkPreview(null);
    setMentionSearch('');
    setMentionResults([]);
    setShowMention(false);
    wasTyping.current = false;
    onTextChange?.('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.overflowY = 'hidden';
    }
  }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleTypingChange = (value) => {
    if (value && !wasTyping.current) {
      wasTyping.current = true;
      onTyping(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      if (wasTyping.current) {
        wasTyping.current = false;
        onTyping(false);
      }
    }, 2000);
  };

  // Link preview — 5 second timeout, then abandon and enable Send
  const previewTimeoutRef = useRef(null);

  const fetchPreview = useCallback(async (url) => {
    setLoadingPreview(true);
    setLinkPreview(null);

    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    const abandonTimer = setTimeout(() => {
      setLoadingPreview(false);
    }, 5000);
    previewTimeoutRef.current = abandonTimer;

    try {
      const { preview } = await api.getLinkPreview(url);
      clearTimeout(abandonTimer);
      if (preview) setLinkPreview(preview);
    } catch {
      clearTimeout(abandonTimer);
    }
    setLoadingPreview(false);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    handleTypingChange(val);
    onTextChange?.(val);

    const el = e.target;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    const maxHeight = lineHeight * 5 + 20;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';

    const cur = e.target.selectionStart;
    const lastAt = val.lastIndexOf('@', cur - 1);
    if (lastAt !== -1) {
      const between = val.slice(lastAt + 1, cur);
      if (!between.includes(' ') && !between.includes('\n')) {
        mentionStart.current = lastAt;
        setMentionSearch(between);
        setShowMention(true);
        api.searchUsers(between, group?.id).then(({ users }) => {
          setMentionResults(users);
          setMentionIndex(0);
        }).catch(() => {});
        return;
      }
    }
    setShowMention(false);

    const urls = val.match(URL_REGEX);
    if (urls && urls[0] !== linkPreview?.url) {
      fetchPreview(urls[0]);
    } else if (!urls) {
      setLinkPreview(null);
    }
  };

  const insertMention = (user) => {
    const before = text.slice(0, mentionStart.current);
    const after = text.slice(inputRef.current.selectionStart);
    const name = user.display_name || user.name;
    setText(before + `@[${name}] ` + after);
    setShowMention(false);
    setMentionResults([]);
    inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    if (showMention && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (mentionIndex >= 0) insertMention(mentionResults[mentionIndex]); return; }
      if (e.key === 'Escape') { setShowMention(false); return; }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && !imageFile) return;

    const lp = linkPreview;
    setText('');
    setLinkPreview(null);
    setImageFile(null);
    setImagePreview(null);
    wasTyping.current = false;
    onTyping(false);
    onTextChange?.('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.overflowY = 'hidden';
    }

    const emojiOnly = !!trimmed && isEmojiOnly(trimmed);
    await onSend({ content: trimmed || null, imageFile, linkPreview: lp, emojiOnly });
  };

  // Insert emoji at cursor position in the textarea
  const handleEmojiSelect = (emoji) => {
    setShowEmojiPicker(false);
    const el = inputRef.current;
    const native = emoji.native;

    if (el) {
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const newText = text.slice(0, start) + native + text.slice(end);
      setText(newText);
      // Restore focus and move cursor after the inserted emoji
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + native.length;
        el.setSelectionRange(pos, pos);
        // Resize textarea
        el.style.height = 'auto';
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        const maxHeight = lineHeight * 5 + 20;
        el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
        el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
      });
    } else {
      // No ref yet — just append
      setText(prev => prev + native);
    }
  };

  const compressImage = (file) => new Promise((resolve) => {
    const MAX_PX = 1920;
    const QUALITY = 0.82;
    const isPng = file.type === 'image/png';
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= MAX_PX && height <= MAX_PX) {
        // already small
      } else {
        const ratio = Math.min(MAX_PX / width, MAX_PX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!isPng) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(img, 0, 0, width, height);
      if (isPng) {
        canvas.toBlob(blob => resolve(new File([blob], file.name, { type: 'image/png' })), 'image/png');
      } else {
        canvas.toBlob(blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', QUALITY);
      }
    };
    img.src = url;
  });

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setImageFile(compressed);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(compressed);
    setShowAttachMenu(false);
  };

  // Detect mobile (touch device)
  const isMobile = () => window.matchMedia('(pointer: coarse)').matches;

  return (
    <div className="message-input-area">
      {/* Reply preview */}
      {replyTo && (
        <div className="reply-bar-input">
          <div className="reply-indicator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            <span>Replying to <strong>{replyTo.user_display_name || replyTo.user_name}</strong></span>
            <span className="reply-preview-text">{replyTo.content?.slice(0, 60) || (replyTo.image_url ? '📷 Image' : '')}</span>
          </div>
          <button className="btn-icon" onClick={onCancelReply}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Image preview */}
      {imagePreview && (
        <div className="img-preview-bar">
          <img src={imagePreview} alt="preview" className="img-preview" />
          <button className="btn-icon" onClick={() => { setImageFile(null); setImagePreview(null); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Link preview */}
      {linkPreview && (
        <div className="link-preview-bar">
          {linkPreview.image && <img src={linkPreview.image} alt="" className="link-prev-img" onError={e => e.target.style.display='none'} />}
          <div className="flex-col flex-1 overflow-hidden gap-1">
            {linkPreview.siteName && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{linkPreview.siteName}</span>}
            <span style={{ fontSize: 13, fontWeight: 600 }} className="truncate">{linkPreview.title}</span>
          </div>
          <button className="btn-icon" onClick={() => setLinkPreview(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Mention dropdown */}
      {showMention && mentionResults.length > 0 && (
        <div className="mention-dropdown">
          {mentionResults.map((u, i) => (
            <button
              key={u.id}
              className={`mention-item ${i === mentionIndex ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
            >
              <div className="mention-avatar-wrap">
                <div className="mention-avatar">{(u.display_name || u.name)?.[0]?.toUpperCase()}</div>
                {onlineUserIds.has(u.id) && <span className="mention-online-dot" />}
              </div>
              <span>{u.display_name || u.name}</span>
              <span className="mention-role">{u.role}</span>
            </button>
          ))}
        </div>
      )}

      <div className="input-row">

        {/* + button — attach menu trigger */}
        <div className="attach-wrap" ref={attachMenuRef}>
          <button
            className="btn-icon input-action attach-btn"
            onClick={() => { setShowAttachMenu(v => !v); setShowEmojiPicker(false); }}
            title="Add photo or emoji"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" width="22" height="22">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </button>

          {showAttachMenu && (
            <div className="attach-menu">
              {/* Photo from library */}
              <button className="attach-item" onClick={() => fileInput.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Photo</span>
              </button>
              {/* Camera — mobile only */}
              {isMobile() && (
                <button className="attach-item" onClick={() => cameraInput.current?.click()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <span>Camera</span>
                </button>
              )}
              {/* Emoji */}
              <button className="attach-item" onClick={() => { setShowAttachMenu(false); setShowEmojiPicker(true); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                <span>Emoji</span>
              </button>
            </div>
          )}
        </div>

        {/* Hidden file inputs */}
        <input ref={fileInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleImageSelect} />

        {/* Emoji picker popover */}
        {showEmojiPicker && (
          <div className="emoji-input-picker" ref={emojiPickerRef}>
            <Picker
              data={data}
              onEmojiSelect={handleEmojiSelect}
              theme="light"
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={2} />
          </div>
        )}

        <div className="input-wrap">
          <textarea
            ref={inputRef}
            className="msg-input"
            placeholder="Text message"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={onInputFocus}
            rows={1}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="sentences"
            spellCheck="true"
            style={{ resize: 'none' }} />
        </div>

        <button
          className={`send-btn ${(text.trim() || imageFile) && !loadingPreview ? 'active' : ''}`}
          onClick={handleSend}
          disabled={(!text.trim() && !imageFile) || loadingPreview}
          title={loadingPreview ? 'Loading preview…' : 'Send'}
        >
          {loadingPreview
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          }
        </button>
      </div>
    </div>
  );
}
