import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import Avatar from './Avatar.jsx';

// ── Shared user checkbox list ─────────────────────────────────────────────────
function UserCheckList({ allUsers, selectedIds, onChange }) {
  const [search, setSearch] = useState('');
  const filtered = allUsers.filter(u =>
    (u.display_name || u.name).toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div>
      <input className="input" placeholder="Search users…" value={search}
        onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }}
               autoComplete="new-password" />
      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        {filtered.map(u => (
          <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedIds.has(u.id)} onChange={() => {
              const next = new Set(selectedIds);
              next.has(u.id) ? next.delete(u.id) : next.add(u.id);
              onChange(next);
            }} style={{ accentColor: 'var(--primary)', width: 15, height: 15 }} />
            <Avatar user={u} size="sm" />
            <span className="flex-1 text-sm">{u.display_name || u.name}</span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{u.role}</span>
          </label>
        ))}
        {filtered.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No users found</div>}
      </div>
    </div>
  );
}

// ── User Group checkbox list ──────────────────────────────────────────────────
function GroupCheckList({ allGroups, selectedIds, onChange }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', maxHeight: 200, overflowY: 'auto' }}>
      {allGroups.map(g => (
        <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
          <input type="checkbox" checked={selectedIds.has(g.id)} onChange={() => {
            const next = new Set(selectedIds);
            next.has(g.id) ? next.delete(g.id) : next.add(g.id);
            onChange(next);
          }} style={{ accentColor: 'var(--primary)', width: 15, height: 15 }} />
          <span className="flex-1 text-sm">{g.name}</span>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{g.member_count} member{g.member_count !== 1 ? 's' : ''}</span>
        </label>
      ))}
      {allGroups.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No user groups yet</div>}
    </div>
  );
}

// ── All Groups tab ────────────────────────────────────────────────────────────
function AllGroupsTab({ allUsers, onRefresh }) {
  const toast = useToast();
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [savedMembers, setSavedMembers] = useState(new Set()); // members as last saved
  const [members, setMembers] = useState(new Set());           // current checkbox state
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(() =>
    api.getUserGroups().then(({ groups }) => setGroups(groups)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const selectGroup = async (g) => {
    setShowDelete(false);
    const { members: mems } = await api.getUserGroup(g.id);
    const ids = new Set(mems.map(m => m.id));
    setSelected(g);
    setEditName(g.name);
    setMembers(ids);
    setSavedMembers(ids);
  };

  const clearSelection = () => {
    setSelected(null); setEditName(''); setMembers(new Set()); setSavedMembers(new Set()); setShowDelete(false);
  };

  const handleSave = async () => {
    if (!editName.trim()) return toast('Name required', 'error');
    setSaving(true);
    try {
      if (selected) {
        await api.updateUserGroup(selected.id, { name: editName.trim(), memberIds: [...members] });
        toast('Group updated', 'success');
        // Refresh saved state
        const { members: fresh } = await api.getUserGroup(selected.id);
        const freshIds = new Set(fresh.map(m => m.id));
        setSavedMembers(freshIds);
        setMembers(freshIds);
        setSelected(prev => ({ ...prev, name: editName.trim() }));
      } else {
        await api.createUserGroup({ name: editName.trim(), memberIds: [...members] });
        toast(`Group "${editName.trim()}" created`, 'success');
        clearSelection();
      }
      load(); onRefresh();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteUserGroup(selected.id);
      toast('Group deleted', 'success');
      clearSelection(); load(); onRefresh();
    } catch (e) { toast(e.message, 'error'); }
    finally { setDeleting(false); }
  };

  // Delete only enabled when group selected AND no saved members remain
  const canDelete = selected && savedMembers.size === 0;
  const isCreating = !selected;

  return (
    <div style={{ display: 'flex', gap: 24, height: '100%', minHeight: 0 }}>
      {/* Group list */}
      <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', paddingRight: 16, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>User Groups</div>
        <button onClick={clearSelection} style={{
          display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none',
          background: isCreating ? 'var(--primary-light)' : 'transparent',
          color: isCreating ? 'var(--primary)' : 'var(--text-secondary)',
          cursor: 'pointer', fontWeight: isCreating ? 600 : 400, fontSize: 13, marginBottom: 4,
        }}>+ New Group</button>
        {groups.map(g => (
          <button key={g.id} onClick={() => selectGroup(g)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none',
            background: selected?.id === g.id ? 'var(--primary-light)' : 'transparent',
            color: selected?.id === g.id ? 'var(--primary)' : 'var(--text-primary)',
            cursor: 'pointer', fontWeight: selected?.id === g.id ? 600 : 400, fontSize: 14, marginBottom: 2,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>UG</div>
              <div>
                <div style={{ fontSize: 13 }}>{g.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{g.member_count} member{g.member_count !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </button>
        ))}
        {groups.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No groups yet</div>}
      </div>

      {/* Form panel */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label className="settings-section-label">Group Name</label>
            <input className="input" value={editName} onChange={e => setEditName(e.target.value)}
              placeholder="e.g. Coaches" style={{ marginTop: 6 }}
               autoComplete="new-password" />
            {isCreating && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 5 }}>A matching Direct Message group will be created automatically.</p>}
          </div>
          <div>
            <label className="settings-section-label">Members</label>
            <div style={{ marginTop: 6 }}>
              <UserCheckList allUsers={allUsers} selectedIds={members} onChange={setMembers} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 5 }}>{members.size} selected</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : isCreating ? 'Create Group' : 'Save Changes'}
            </button>
            {!isCreating && <button className="btn btn-secondary btn-sm" onClick={clearSelection}>Cancel</button>}
            {!isCreating && (
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto', background: canDelete ? 'var(--error)' : 'var(--surface-variant)', color: canDelete ? 'white' : 'var(--text-tertiary)', cursor: canDelete ? 'pointer' : 'not-allowed' }}
                onClick={canDelete ? () => setShowDelete(true) : undefined}
                title={canDelete ? 'Delete group' : 'Remove all members before deleting'}
                disabled={!canDelete}
              >Delete Group</button>
            )}
          </div>
          {showDelete && (
            <div style={{ background: '#fce8e6', border: '1px solid #f5c6c2', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
              <p style={{ fontSize: 13, color: 'var(--error)', marginBottom: 12 }}>Delete <strong>{selected?.name}</strong>? This also deletes the associated direct message group. Cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" style={{ background: 'var(--error)', color: 'white' }} onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, Delete'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowDelete(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Direct Messages tab ───────────────────────────────────────────────────────
function DirectMessagesTab({ allUserGroups, onRefresh, refreshKey }) {
  const toast = useToast();
  const [dms, setDms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [savedGroupIds, setSavedGroupIds] = useState(new Set());
  const [groupIds, setGroupIds] = useState(new Set());
  const [dmName, setDmName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(() =>
    api.getMultiGroupDms().then(({ dms }) => setDms(dms || [])).catch(e => console.error('multigroup load error:', e)), []);
  // Reload whenever parent refreshes (e.g. after user group changes that affect membership)
  useEffect(() => { load(); }, [load, refreshKey]);

  const clearSelection = () => {
    setSelected(null); setDmName(''); setGroupIds(new Set()); setSavedGroupIds(new Set()); setShowDelete(false);
  };

  const selectDm = (dm) => {
    setShowDelete(false);
    setSelected(dm);
    setDmName(dm.name);
    const ids = new Set(dm.memberGroupIds || []);
    setGroupIds(ids);
    setSavedGroupIds(ids);
  };

  const handleSave = async () => {
    if (!dmName.trim()) return toast('Name required', 'error');
    if (!selected && groupIds.size < 2) return toast('Select at least two user groups', 'error');
    setSaving(true);
    try {
      if (selected) {
        await api.updateMultiGroupDm(selected.id, { name: dmName.trim(), userGroupIds: [...groupIds] });
        toast('Multi-group DM updated', 'success');
        const freshDms = await api.getMultiGroupDms();
        const fresh = freshDms.dms.find(d => d.id === selected.id);
        if (fresh) { const ids = new Set(fresh.memberGroupIds || []); setSavedGroupIds(ids); setGroupIds(ids); setSelected(fresh); }
      } else {
        await api.createMultiGroupDm({ name: dmName.trim(), userGroupIds: [...groupIds] });
        toast(`Multi-group DM "${dmName.trim()}" created`, 'success');
        clearSelection();
      }
      load(); onRefresh();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteMultiGroupDm(selected.id);
      toast('Deleted', 'success');
      clearSelection(); load(); onRefresh();
    } catch (e) { toast(e.message, 'error'); }
    finally { setDeleting(false); }
  };

  const canDelete = selected && savedGroupIds.size === 0;
  const isCreating = !selected;

  return (
    <div style={{ display: 'flex', gap: 24, height: '100%', minHeight: 0 }}>
      {/* DM list */}
      <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', paddingRight: 16, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>Managed Multi Group DMs</div>
        <button onClick={clearSelection} style={{
          display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none',
          background: isCreating ? 'var(--primary-light)' : 'transparent',
          color: isCreating ? 'var(--primary)' : 'var(--text-secondary)',
          cursor: 'pointer', fontWeight: isCreating ? 600 : 400, fontSize: 13, marginBottom: 4,
        }}>+ New Multi-Group DM</button>
        {dms.map(dm => (
          <button key={dm.id} onClick={() => selectDm(dm)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none',
            background: selected?.id === dm.id ? 'var(--primary-light)' : 'transparent',
            color: selected?.id === dm.id ? 'var(--primary)' : 'var(--text-primary)',
            cursor: 'pointer', fontWeight: selected?.id === dm.id ? 600 : 400, fontSize: 14, marginBottom: 2,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>MG</div>
              <div>
                <div style={{ fontSize: 13 }}>{dm.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{dm.group_count} group{dm.group_count !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </button>
        ))}
        {dms.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No multi-group DMs yet</div>}
      </div>

      {/* Form panel */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label className="settings-section-label">DM Name</label>
            <input className="input" value={dmName} onChange={e => setDmName(e.target.value)}
              placeholder="e.g. Coaches + Players" style={{ marginTop: 6 }}
               autoComplete="new-password" />
          </div>
          <div>
            <label className="settings-section-label">Member Groups</label>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 8px' }}>Select two or more user groups. All members of each group will have access to this conversation.</p>
            <GroupCheckList allGroups={allUserGroups} selectedIds={groupIds} onChange={setGroupIds} />
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 5 }}>{groupIds.size} group{groupIds.size !== 1 ? 's' : ''} selected</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : isCreating ? 'Create Multi-Group DM' : 'Save Changes'}
            </button>
            {!isCreating && <button className="btn btn-secondary btn-sm" onClick={clearSelection}>Cancel</button>}
            {!isCreating && (
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto', background: canDelete ? 'var(--error)' : 'var(--surface-variant)', color: canDelete ? 'white' : 'var(--text-tertiary)', cursor: canDelete ? 'pointer' : 'not-allowed' }}
                onClick={canDelete ? () => setShowDelete(true) : undefined}
                title={canDelete ? 'Delete' : 'Remove all member groups before deleting'}
                disabled={!canDelete}
              >Delete</button>
            )}
          </div>
          {showDelete && (
            <div style={{ background: '#fce8e6', border: '1px solid #f5c6c2', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
              <p style={{ fontSize: 13, color: 'var(--error)', marginBottom: 12 }}>Delete <strong>{selected?.name}</strong>? This also deletes the associated direct message group. Cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" style={{ background: 'var(--error)', color: 'white' }} onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, Delete'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowDelete(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function GroupManagerModal({ onClose }) {
  const [tab, setTab] = useState('all');
  const [allUsers, setAllUsers] = useState([]);
  const [allUserGroups, setAllUserGroups] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const onRefresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    api.searchUsers('').then(({ users }) => setAllUsers(users.filter(u => u.status === 'active'))).catch(() => {});
    api.getUserGroups().then(({ groups }) => setAllUserGroups(groups)).catch(() => {});
  }, [refreshKey]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 1024, width: '96vw', height: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16, flexShrink: 0 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Group Manager</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex gap-2" style={{ marginBottom: 20, flexShrink: 0 }}>
          <button className={`btn btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('all')}>All Groups</button>
          <button className={`btn btn-sm ${tab === 'dm' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('dm')}>Direct Messages</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {tab === 'all' && <AllGroupsTab allUsers={allUsers} onRefresh={onRefresh} />}
          {tab === 'dm'  && <DirectMessagesTab allUserGroups={allUserGroups} onRefresh={onRefresh} refreshKey={refreshKey} />}
        </div>
      </div>
    </div>
  );
}
