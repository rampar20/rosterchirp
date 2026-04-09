import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import Avatar from './Avatar.jsx';

export default function GroupInfoModal({ group, onClose, onUpdated, onBack }) {
  const { user } = useAuth();
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(group.name);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [customName, setCustomName] = useState(group.owner_name_original ? group.name : '');
  const [savedCustomName, setSavedCustomName] = useState(group.owner_name_original ? group.name : '');
  const [savingCustom, setSavingCustom] = useState(false);

  const isDirect = !!group.is_direct;
  const isManaged = !!group.is_managed; // UG DM or Multi-Group DM — only editable via Group Manager
  const isOwner = group.owner_id === user.id;
  const isAdmin = user.role === 'admin';
  const canManage = !isDirect && !isManaged && ((group.type === 'private' && isOwner) || (group.type === 'public' && isAdmin));
  const canRename = !isDirect && !isManaged && !group.is_default && ((group.type === 'public' && isAdmin) || (group.type === 'private' && isOwner));

  useEffect(() => {
    if (group.type === 'private') {
      api.getMembers(group.id).then(({ members }) => setMembers(members)).catch(() => {});
    }
  }, [group.id]);

  const handleCustomName = async () => {
    setSavingCustom(true);
    try {
      const saved = customName.trim();
      await api.setCustomGroupName(group.id, saved);
      setSavedCustomName(saved);
      toast(saved ? 'Custom name saved' : 'Custom name removed', 'success');
      onUpdated();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingCustom(false);
    }
  };

  useEffect(() => {
    if (addSearch) {
      api.searchUsers(addSearch).then(({ users }) => setAddResults(users)).catch(() => {});
    }
  }, [addSearch]);

  const handleRename = async () => {
    if (!newName.trim() || newName === group.name) { setEditing(false); return; }
    try {
      await api.renameGroup(group.id, newName.trim());
      toast('Renamed', 'success');
      onUpdated();
      setEditing(false);
    } catch (e) { toast(e.message, 'error'); }
  };

  const handleLeave = async () => {
    if (!confirm('Leave this message?')) return;
    try {
      await api.leaveGroup(group.id);
      toast('Left message', 'success');
      onClose();
      if (isDirect) {
        // For direct messages: socket group:deleted fired by server handles
        // removing from sidebar and clearing active group — no manual refresh needed
      } else {
        onUpdated();
        if (onBack) onBack();
      }
    } catch (e) { toast(e.message, 'error'); }
  };

  const handleTakeOwnership = async () => {
    if (!confirm('Take ownership of this private group?')) return;
    try {
      await api.takeOwnership(group.id);
      toast('Ownership taken', 'success');
      onUpdated();
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };

  const handleAdd = async (u) => {
    try {
      await api.addMember(group.id, u.id);
      toast(`${u.name} added`, 'success');
      api.getMembers(group.id).then(({ members }) => setMembers(members));
      setAddSearch('');
      setAddResults([]);
    } catch (e) { toast(e.message, 'error'); }
  };

  const handleRemove = async (member) => {
    if (!confirm(`Remove ${member.name}?`)) return;
    try {
      await api.removeMember(group.id, member.id);
      toast(`${member.name} removed`, 'success');
      setMembers(prev => prev.filter(m => m.id !== member.id));
    } catch (e) { toast(e.message, 'error'); }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this message? This cannot be undone.')) return;
    try {
      await api.deleteGroup(group.id);
      toast('Deleted', 'success');
      onUpdated();
      onClose();
      if (onBack) onBack();
    } catch (e) { toast(e.message, 'error'); }
  };

  // For direct messages: only show Delete button (owner = remaining user after other left)
  const canDeleteDirect = isDirect && isOwner && !isManaged;
  const canDeleteRegular = !isDirect && !isManaged && (isOwner || (isAdmin && group.type === 'public')) && !group.is_default;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Message Info</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          {editing ? (
            <div className="flex gap-2">
              <input className="input flex-1" value={newName} onChange={e => setNewName(e.target.value)} autoComplete="off" onKeyDown={e => e.key === 'Enter' && handleRename()} autoCorrect="off" autoCapitalize="off" spellCheck={false} />
              <button className="btn btn-primary btn-sm" onClick={handleRename}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-8" style={{ gap: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, flex: 1 }}>{group.name}</h3>
              {canRename && (
                <button className="btn-icon" onClick={() => setEditing(true)} title="Rename">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-6" style={{ gap: 8, marginTop: 4 }}>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {isDirect ? 'Direct message' : group.type === 'public' ? 'Public message' : 'Private message'}
            </span>
            {!!group.is_readonly && <span className="readonly-badge" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#fff3e0', color: '#e65100' }}>Read-only</span>}
          </div>
        </div>

        {/* Custom name — any user can set their own display name for this group */}
        <div style={{ marginBottom: 16 }}>
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            Your custom name <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(only visible to you)</span>
          </label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={customName}
              onChange={e => setCustomName(e.target.value)} autoComplete="off" placeholder={group.owner_name_original || group.name}
              onKeyDown={e => e.key === 'Enter' && handleCustomName()} />
            {customName.trim() !== savedCustomName ? (
              <button className="btn btn-primary btn-sm" onClick={handleCustomName} disabled={savingCustom}>
                Save
              </button>
            ) : savedCustomName ? (
              <button className="btn btn-sm" style={{ background: 'var(--surface-variant)', color: 'var(--text-secondary)' }}
                onClick={() => { setCustomName(''); }}
                disabled={savingCustom}>
                Remove
              </button>
            ) : null}
          </div>
          {group.owner_name_original && (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
              Showing as: <strong>{customName.trim() || group.owner_name_original}</strong>
              {customName.trim() && <span> ({group.owner_name_original})</span>}
            </p>
          )}
        </div>

        {/* Members — shown for private non-direct groups */}
        {group.type === 'private' && !isDirect && (
          <div style={{ marginBottom: 16 }}>
            <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
              Members ({members.length})
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[...members].sort((a, b) => a.name.localeCompare(b.name)).map(m => (
                <div key={m.id} className="flex items-center" style={{ gap: 10, padding: '6px 0' }}>
                  <Avatar user={m} size="sm" />
                  <span className="flex-1 text-sm">{m.name}</span>
                  {m.status === 'deleted' && <span className="text-xs" style={{ color: 'var(--error)', marginRight: 4 }}>Deleted</span>}
                  {m.id === group.owner_id && m.status !== 'deleted' && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Owner</span>}
                  {/* Allow removal if: canManage + not owner, OR admin + deleted orphan */}
                  {(( canManage && m.id !== group.owner_id) || (isAdmin && m.status === 'deleted')) && (
                    <button
                      onClick={() => handleRemove(m)}
                      title={m.status === 'deleted' ? 'Remove orphaned member' : 'Remove'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: m.status === 'deleted' ? 'var(--error)' : 'var(--text-tertiary)', padding: '2px 4px', borderRadius: 4, lineHeight: 1, transition: 'color var(--transition)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--error)'}
                      onMouseLeave={e => e.currentTarget.style.color = m.status === 'deleted' ? 'var(--error)' : 'var(--text-tertiary)'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canManage && (
              <div style={{ marginTop: 12 }}>
                <input className="input" placeholder="Search to add member..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={addSearch} onChange={e => setAddSearch(e.target.value)} />
                {addResults.length > 0 && addSearch && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: 4, maxHeight: 150, overflowY: 'auto', background: 'var(--surface)' }}>
                    {addResults.filter(u => !members.find(m => m.id === u.id)).map(u => (
                      <button key={u.id} className="flex items-center gap-2 w-full" style={{ gap: 10, padding: '8px 12px', textAlign: 'left', transition: 'background var(--transition)', color: 'var(--text-primary)' }} onClick={() => handleAdd(u)} onMouseEnter={e => e.currentTarget.style.background = 'var(--background)'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <Avatar user={u} size="sm" />
                        <span className="text-sm flex-1">{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex-col gap-2">
          {/* Managed group notice */}
          {isManaged && (
            <div style={{ background: 'var(--surface-variant)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              This conversation is managed via the Group Manager tool.
            </div>
          )}
          {/* Direct message: leave (if not already owner/last person) */}
          {isDirect && !isManaged && !isOwner && (
            <button className="btn btn-secondary w-full" onClick={handleLeave}>Leave Conversation</button>
          )}
          {/* Regular private: leave if not owner */}
          {!isDirect && !isManaged && group.type === 'private' && !isOwner && (
            <button className="btn btn-secondary w-full" onClick={handleLeave}>Leave Group</button>
          )}
          {/* Admin take ownership (non-direct, non-managed only) */}
          {!isDirect && !isManaged && isAdmin && group.type === 'private' && !isOwner && (
            <button className="btn btn-secondary w-full" onClick={handleTakeOwnership}>Take Ownership (Admin)</button>
          )}
          {/* Delete */}
          {(canDeleteDirect || canDeleteRegular) && (
            <button className="btn btn-danger w-full" onClick={handleDelete}>Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}
