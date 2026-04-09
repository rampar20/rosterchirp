import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import Avatar from './Avatar.jsx';

export default function NewChatModal({ onClose, onCreated, features = {} }) {
  const { user } = useAuth();
  const toast = useToast();

  const msgPublic       = features.msgPublic       ?? true;
  const msgU2U          = features.msgU2U          ?? true;
  const msgPrivateGroup = features.msgPrivateGroup ?? true;
  const loginType       = features.loginType || 'all_ages';

  // Default to private if available, otherwise public
  const defaultTab = (msgU2U || msgPrivateGroup) ? 'private' : 'public';
  const [tab, setTab] = useState(defaultTab);
  const [name, setName] = useState('');
  const [isReadonly, setIsReadonly] = useState(false);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  // Pre-confirmation for minor members (shown before creating the chat)
  const [minorConfirm, setMinorConfirm] = useState(null); // { minorNames: [] } — pending create

  // True when exactly 1 user selected on private tab AND U2U messages are enabled
  const isDirect = tab === 'private' && selected.length === 1 && msgU2U;

  useEffect(() => {
    api.searchUsers('').then(({ users }) => setUsers(users)).catch(() => {});
  }, []);

  useEffect(() => {
    if (search) {
      api.searchUsers(search).then(({ users }) => setUsers(users)).catch(() => {});
    }
  }, [search]);

  const toggle = (u) => {
    if (u.id === user.id) return;
    // If private groups are disabled, cap selection at 1 (DM only)
    setSelected(prev => {
      if (prev.find(p => p.id === u.id)) return prev.filter(p => p.id !== u.id);
      if (!msgPrivateGroup && prev.length >= 1) return prev; // can't add more for DM-only
      return [...prev, u];
    });
  };

  const doCreate = async () => {
    setLoading(true);
    try {
      let payload;
      if (isDirect) {
        payload = {
          type: 'private',
          memberIds: selected.map(u => u.id),
          isDirect: true,
        };
      } else {
        payload = {
          name: name.trim(),
          type: tab,
          memberIds: selected.map(u => u.id),
          isReadonly: tab === 'public' && isReadonly,
        };
      }

      const { group, duplicate, guardianAdded } = await api.createGroup(payload);
      if (duplicate) {
        toast('A group with these members already exists — opening it now.', 'info');
      } else {
        toast(isDirect ? 'Direct message started!' : `${tab === 'public' ? 'Public message' : 'Group message'} created!`, 'success');
        if (guardianAdded) {
          toast('A guardian has been added to this conversation.', 'info');
        }
      }
      onCreated(group);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (tab === 'private' && selected.length === 0) return toast('Add at least one member', 'error');
    if (tab === 'private' && !isDirect && !name.trim()) return toast('Name required', 'error');
    if (tab === 'public' && !name.trim()) return toast('Name required', 'error');

    // Mixed Age: warn if any selected member is a minor (and initiator is not a minor)
    if (loginType === 'mixed_age' && !user.is_minor) {
      const minors = selected.filter(u => u.is_minor);
      if (minors.length > 0) {
        setMinorConfirm({ minorNames: minors.map(u => u.display_name || u.name) });
        return;
      }
    }

    await doCreate();
  };

  // Placeholder for the name field
  const namePlaceholder = isDirect
    ? selected[0]?.name || ''
    : tab === 'public' ? 'e.g. Announcements' : 'e.g. Project Team';

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Start a Chat</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {user.role === 'admin' && (msgU2U || msgPrivateGroup || msgPublic) && (
          <div className="flex gap-2" style={{ marginBottom: 20 }}>
            {(msgU2U || msgPrivateGroup) && <button className={`btn ${tab === 'private' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setTab('private')}>Direct Message</button>}
            {msgPublic && <button className={`btn ${tab === 'public' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setTab('public')}>Public Message</button>}
          </div>
        )}

        {/* Message Name — public always, private when not a DM and at least 1 member selected */}
        {(tab === 'public' || (tab === 'private' && !isDirect && selected.length > 0)) && (
          <div className="flex-col gap-2" style={{ marginBottom: 16 }}>
            <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Message Name</label>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)} placeholder={namePlaceholder}
              autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false} />
          </div>
        )}

        {/* Readonly toggle for public */}
        {tab === 'public' && user.role === 'admin' && (
          <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 16, cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={isReadonly} onChange={e => setIsReadonly(e.target.checked)} />
            Read-only message (only admins can post)
          </label>
        )}

        {/* Member selector for private tab */}
        {tab === 'private' && (
          <>
            <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {isDirect ? 'Direct Message with' : 'Add Members'}
              </label>
              <input className="input" placeholder="Search users..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {selected.length > 0 && (
              <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
                {selected.map(u => (
                  <span key={u.id} className="chip">
                    {u.name}
                    <span className="chip-remove" onClick={() => toggle(u)}>×</span>
                  </span>
                ))}
              </div>
            )}

            {isDirect && (
              <p className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 12, fontStyle: 'italic' }}>
                A private two-person conversation. Select a second person to create a group instead.
              </p>
            )}

            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              {users.filter(u => u.id !== user.id && u.allow_dm !== 0).sort((a, b) => a.name.localeCompare(b.name)).map(u => (
                <label key={u.id} className="flex items-center gap-10 pointer" style={{ padding: '10px 14px', gap: 12, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!selected.find(s => s.id === u.id)} onChange={() => toggle(u)} />
                  <Avatar user={u} size="sm" />
                  <span className="flex-1 text-sm">{u.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{u.role}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="flex gap-2 justify-between" style={{ marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : isDirect ? 'Start Conversation' : 'Create'}
          </button>
        </div>
      </div>

      {/* Pre-confirmation modal: minor member warning */}
      {minorConfirm && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 380 }}>
            <h2 className="modal-title" style={{ marginBottom: 12 }}>Guardian Notice</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
              The following member{minorConfirm.minorNames.length > 1 ? 's are' : ' is'} a minor:
            </p>
            <ul style={{ marginBottom: 16, paddingLeft: 20 }}>
              {minorConfirm.minorNames.map(n => (
                <li key={n} className="text-sm" style={{ color: 'var(--text-primary)' }}>{n}</li>
              ))}
            </ul>
            <p className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              Their designated guardian(s) will be automatically added to this conversation. Do you want to proceed?
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn btn-secondary" onClick={() => setMinorConfirm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { setMinorConfirm(null); doCreate(); }}>Proceed</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
