import { useState, useEffect, useCallback } from 'react';
import UserFooter from '../components/UserFooter.jsx';

// ── useKeyboardOpen — true when software keyboard is visible ─────────────────
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', handler);
    return () => vv.removeEventListener('resize', handler);
  }, []);
  return open;
}
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import Avatar from '../components/Avatar.jsx';

// ── Shared sub-components (identical logic to modal versions) ─────────────────

function UserCheckList({ allUsers, selectedIds, onChange, onIF, onIB }) {
  const [search, setSearch] = useState('');
  const filtered = allUsers
    .filter(u => (u.display_name||u.name).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.display_name||a.name).localeCompare(b.display_name||b.name));
  return (
    <div>
      <input className="input" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} autoComplete="off" style={{ marginBottom:8 }} onFocus={onIF} onBlur={onIB} />
      <div style={{ maxHeight:220, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
        {filtered.map(u => (
          <label key={u.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
            <input type="checkbox" checked={selectedIds.has(u.id)} onChange={() => { const n=new Set(selectedIds); n.has(u.id)?n.delete(u.id):n.add(u.id); onChange(n); }}
              style={{ accentColor:'var(--primary)', width:15, height:15 }} />
            <Avatar user={u} size="sm" />
            <span className="flex-1 text-sm">{u.display_name||u.name}</span>
            <span className="text-xs" style={{ color:'var(--text-tertiary)' }}>{u.role}</span>
          </label>
        ))}
        {filtered.length === 0 && <div style={{ padding:16, textAlign:'center', color:'var(--text-tertiary)', fontSize:13 }}>No users found</div>}
      </div>
    </div>
  );
}

function AliasCheckList({ allAliases, selectedIds, onChange, onIF, onIB }) {
  const [search, setSearch] = useState('');
  const filtered = allAliases
    .filter(a => `${a.first_name} ${a.last_name}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
  return (
    <div>
      <input className="input" placeholder="Search aliases…" value={search} onChange={e => setSearch(e.target.value)} autoComplete="off" style={{ marginBottom:8 }} onFocus={onIF} onBlur={onIB} />
      <div style={{ maxHeight:220, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
        {filtered.map(a => (
          <label key={a.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
            <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => { const n=new Set(selectedIds); n.has(a.id)?n.delete(a.id):n.add(a.id); onChange(n); }}
              style={{ accentColor:'var(--primary)', width:15, height:15 }} />
            <span className="flex-1 text-sm">{a.first_name} {a.last_name}</span>
            <span className="text-xs" style={{ color:'var(--text-tertiary)' }}>{a.guardian_display_name || a.guardian_name}</span>
          </label>
        ))}
        {filtered.length === 0 && <div style={{ padding:16, textAlign:'center', color:'var(--text-tertiary)', fontSize:13 }}>No aliases found</div>}
      </div>
    </div>
  );
}

function GroupCheckList({ allGroups, selectedIds, onChange }) {
  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', maxHeight:220, overflowY:'auto' }}>
      {allGroups.map(g => (
        <label key={g.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
          <input type="checkbox" checked={selectedIds.has(g.id)} onChange={() => { const n=new Set(selectedIds); n.has(g.id)?n.delete(g.id):n.add(g.id); onChange(n); }}
            style={{ accentColor:'var(--primary)', width:15, height:15 }} />
          <span className="flex-1 text-sm">{g.name}</span>
          <span className="text-xs" style={{ color:'var(--text-tertiary)' }}>{g.member_count} member{g.member_count!==1?'s':''}</span>
        </label>
      ))}
      {allGroups.length === 0 && <div style={{ padding:16, textAlign:'center', color:'var(--text-tertiary)', fontSize:13 }}>No user groups yet</div>}
    </div>
  );
}

// ── All Groups tab ────────────────────────────────────────────────────────────
function AllGroupsTab({ allUsers, onRefresh, isMobile = false, onIF, onIB, playersGroupId }) {
  const toast = useToast();
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [savedMembers, setSavedMembers] = useState(new Set());
  const [members, setMembers] = useState(new Set());
  const [fullMembers, setFullMembers] = useState([]); // full member objects including deleted
  const [aliasMembers, setAliasMembers] = useState([]); // child aliases in this group
  const [allAliases, setAllAliases] = useState([]); // all aliases for players group management
  const [aliasSelection, setAliasSelection] = useState(new Set()); // selected alias ids for players group
  const [editName, setEditName] = useState('');
  const [noDm, setNoDm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);

  const load = useCallback(() =>
    api.getUserGroups().then(({ groups }) => setGroups([...(groups||[])].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const selectGroup = async (g) => {
    setShowDelete(false);
    setAccordionOpen(false);
    const { members: mems, aliasMembers: aliases } = await api.getUserGroup(g.id);
    const ids = new Set(mems.map(m => m.id));
    setSelected(g); setEditName(g.name); setMembers(ids); setSavedMembers(ids);
    setFullMembers(mems);
    setAliasMembers(aliases || []);
    // No DM → checkbox enabled+checked; has DM → checkbox disabled+unchecked
    setNoDm(!g.dm_group_id);
    // Players group: load all aliases for alias-based membership management
    if (playersGroupId && g.id === playersGroupId) {
      api.getAllAliases().then(({ aliases: all }) => {
        setAllAliases(all || []);
        setAliasSelection(new Set((aliases || []).map(a => a.id)));
      }).catch(() => {});
    } else {
      setAllAliases([]);
      setAliasSelection(new Set());
    }
  };
  const clearSelection = () => {
    setSelected(null); setEditName(''); setMembers(new Set()); setSavedMembers(new Set());
    setShowDelete(false); setFullMembers([]); setAliasMembers([]); setNoDm(false);
    setAllAliases([]); setAliasSelection(new Set());
  };

  const isPlayersGroup = !!(playersGroupId && selected?.id === playersGroupId);

  const handleSave = async () => {
    if (!editName.trim()) return toast('Name required', 'error');
    setSaving(true);
    try {
      if (selected) {
        // createDm=true when the group has no DM and the user unchecked "Do not create Group DM"
        const createDm = !selected.dm_group_id && !noDm;
        const body = isPlayersGroup
          ? { name: editName.trim(), memberIds: [], aliasMemberIds: [...aliasSelection], createDm }
          : { name: editName.trim(), memberIds: [...members], createDm };
        const { group: updated } = await api.updateUserGroup(selected.id, body);
        toast('Group updated', 'success');
        const { members: fresh, aliasMembers: freshAliases } = await api.getUserGroup(selected.id);
        const freshIds = new Set(fresh.map(m => m.id));
        setSavedMembers(freshIds); setMembers(freshIds); setFullMembers(fresh); setAliasMembers(freshAliases || []);
        if (isPlayersGroup) {
          setAliasSelection(new Set((freshAliases || []).map(a => a.id)));
          setAllAliases(prev => prev); // keep existing list
        }
        // Reflect new dm_group_id if a DM was just created
        setSelected(prev => ({ ...prev, name: editName.trim(), dm_group_id: updated?.dm_group_id ?? prev.dm_group_id }));
        if (createDm) setNoDm(false);
      } else {
        await api.createUserGroup({ name: editName.trim(), memberIds: [...members], noDm });
        toast(`Group "${editName.trim()}" created`, 'success');
        clearSelection();
      }
      load(); onRefresh();
    } catch(e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.deleteUserGroup(selected.id); toast('Group deleted', 'success'); clearSelection(); load(); onRefresh(); }
    catch(e) { toast(e.message, 'error'); }
    finally { setDeleting(false); }
  };

  const canDelete = selected && savedMembers.size === 0;
  const isCreating = !selected;
  const deletedMembers = fullMembers.filter(m => m.status === 'deleted');

  const forceRemoveMember = async (m) => {
    if (!confirm(`Force-remove deleted user "${m.name}" from this group?`)) return;
    try {
      await api.removeUserGroupMember(selected.id, m.id);
      toast(`${m.name} removed`, 'success');
      const { members: fresh } = await api.getUserGroup(selected.id);
      const freshIds = new Set(fresh.map(x => x.id));
      setSavedMembers(freshIds); setMembers(freshIds); setFullMembers(fresh);
      load(); onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  };

  return (
    <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:0, height:'100%', minHeight:0, overflow: isMobile ? 'auto' : 'hidden' }}>

      {/* Sidebar — desktop only */}
      {!isMobile && (
        <div style={{ width:220, flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'12px 8px' }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.8px', textTransform:'uppercase', color:'var(--text-tertiary)', marginBottom:8, paddingLeft:4 }}>User Groups</div>
          <button onClick={clearSelection} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'var(--radius)', border:'none',
            background:isCreating?'var(--primary-light)':'transparent', color:isCreating?'var(--primary)':'var(--text-secondary)',
            cursor:'pointer', fontWeight:isCreating?600:400, fontSize:13, marginBottom:4 }}>+ New Group</button>
          {groups.map(g => (
            <button key={g.id} onClick={() => selectGroup(g)} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'var(--radius)', border:'none',
              background:selected?.id===g.id?'var(--primary-light)':'transparent', color:selected?.id===g.id?'var(--primary)':'var(--text-primary)',
              cursor:'pointer', fontWeight:selected?.id===g.id?600:400, fontSize:13, marginBottom:2 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:26, height:26, borderRadius:6, background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:9, fontWeight:700, flexShrink:0 }}>UG</div>
                <div><div style={{ fontSize:13 }}>{g.name}</div><div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{g.member_count} member{g.member_count!==1?'s':''}</div></div>
              </div>
            </button>
          ))}
          {groups.length===0 && <div style={{ fontSize:13, color:'var(--text-tertiary)', padding:'8px 4px' }}>No groups yet</div>}
        </div>
      )}

      {/* Mobile accordion */}
      {isMobile && (
        <div style={{ padding:'8px 8px 4px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={clearSelection} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'var(--radius)', border:'none',
            background:isCreating?'var(--primary-light)':'transparent', color:isCreating?'var(--primary)':'var(--text-secondary)',
            cursor:'pointer', fontWeight:isCreating?600:400, fontSize:13, marginBottom:6 }}>+ New Group</button>
          <button onClick={() => setAccordionOpen(o => !o)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'8px 10px',
            borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer',
            fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom: accordionOpen ? 4 : 0 }}>
            <span>Edit Existing</span>
            <span style={{ fontSize:10, opacity:0.6 }}>{accordionOpen ? '▲' : '▼'}</span>
          </button>
          {accordionOpen && (
            <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
              {groups.map(g => (
                <button key={g.id} onClick={() => selectGroup(g)} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 12px',
                  border:'none', borderBottom:'1px solid var(--border)',
                  background:selected?.id===g.id?'var(--primary-light)':'transparent', color:selected?.id===g.id?'var(--primary)':'var(--text-primary)',
                  cursor:'pointer', fontWeight:selected?.id===g.id?600:400, fontSize:13 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:22, height:22, borderRadius:5, background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:8, fontWeight:700, flexShrink:0 }}>UG</div>
                    <div><div style={{ fontSize:13 }}>{g.name}</div><div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{g.member_count} member{g.member_count!==1?'s':''}</div></div>
                  </div>
                </button>
              ))}
              {groups.length===0 && <div style={{ fontSize:13, color:'var(--text-tertiary)', padding:'8px 12px' }}>No groups yet</div>}
            </div>
          )}
        </div>
      )}

      {/* Form */}
      <div style={{ flex:1, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '16px 12px' : '16px 24px' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:18, maxWidth: isMobile ? '100%' : 520 }}>
          <div>
            <label className="settings-section-label">Group Name</label>
            <input className="input" value={editName} onChange={e => setEditName(e.target.value)} autoComplete="off" placeholder="e.g. Coaches" style={{ marginTop:6 }} onFocus={onIF} onBlur={onIB} />
            {isCreating && !noDm && <p style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:5 }}>A matching Direct Message group will be created automatically.</p>}
            <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:8, cursor: (selected && selected.dm_group_id) ? 'not-allowed' : 'pointer', opacity: (selected && selected.dm_group_id) ? 0.5 : 1 }}>
              <input
                type="checkbox"
                checked={noDm}
                disabled={!!(selected && selected.dm_group_id)}
                onChange={e => setNoDm(e.target.checked)}
                style={{ width:15, height:15, cursor: (selected && selected.dm_group_id) ? 'not-allowed' : 'pointer' }}
              />
              <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Do not create Group DM</span>
            </label>
            {selected && selected.dm_group_id && <p style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:4 }}>Group DM already exists — cannot be removed.</p>}
          </div>
          <div>
            <label className="settings-section-label">{isPlayersGroup ? 'Child Aliases' : 'Members'}</label>
            {isPlayersGroup ? (
              <div style={{ marginTop:6 }}>
                <AliasCheckList allAliases={allAliases} selectedIds={aliasSelection} onChange={setAliasSelection} onIF={onIF} onIB={onIB} />
                <p style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:5 }}>{aliasSelection.size} selected</p>
              </div>
            ) : (
              <>
                <div style={{ marginTop:6 }}><UserCheckList allUsers={allUsers} selectedIds={members} onChange={setMembers} onIF={onIF} onIB={onIB} /></div>
                <p style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:5 }}>{members.size} selected</p>
              </>
            )}
          </div>
          {!isPlayersGroup && aliasMembers.length > 0 && (
            <div>
              <label className="settings-section-label">Child Aliases</label>
              <div style={{ marginTop:6, border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
                {aliasMembers.map((a, i) => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderBottom: i < aliasMembers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ flex:1, fontSize:13 }}>{a.name}</span>
                    {a.date_of_birth && <span style={{ fontSize:11, color:'var(--text-tertiary)' }}>{a.date_of_birth.slice(0,10)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {deletedMembers.length > 0 && (
            <div>
              <label className="settings-section-label" style={{ color:'var(--error)' }}>
                Orphaned Members (deleted users)
              </label>
              <div style={{ marginTop:6, border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
                {deletedMembers.map(m => (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ flex:1, fontSize:13, color:'var(--text-tertiary)', textDecoration:'line-through' }}>{m.name}</span>
                    <span style={{ fontSize:11, color:'var(--error)', marginRight:8 }}>Deleted</span>
                    <button className="btn btn-danger btn-sm" onClick={() => forceRemoveMember(m)}>Remove</button>
                  </div>
                ))}
              </div>
              <p style={{ fontSize:11, color:'var(--text-tertiary)', marginTop:4 }}>
                These users were deleted but remain as group members. Remove them to allow this group to be deleted.
              </p>
            </div>
          )}
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving?'Saving…':isCreating?'Create Group':'Save Changes'}</button>
            {!isCreating && <button className="btn btn-secondary btn-sm" onClick={clearSelection}>Cancel</button>}
            {!isCreating && (
              <button className="btn btn-sm" style={{ marginLeft:'auto', background:canDelete?'var(--error)':'var(--surface-variant)', color:canDelete?'white':'var(--text-tertiary)', cursor:canDelete?'pointer':'not-allowed' }}
                onClick={canDelete ? () => setShowDelete(true) : undefined} disabled={!canDelete}
                title={canDelete?'Delete group':'Remove all members before deleting'}>Delete Group</button>
            )}
          </div>
          {showDelete && (
            <div style={{ background:'#fce8e6', border:'1px solid #f5c6c2', borderRadius:'var(--radius)', padding:'14px 16px' }}>
              <p style={{ fontSize:13, color:'var(--error)', marginBottom:12 }}>Delete <strong>{selected?.name}</strong>? This also deletes the associated direct message group.</p>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-sm" style={{ background:'var(--error)', color:'white' }} onClick={handleDelete} disabled={deleting}>{deleting?'Deleting…':'Yes, Delete'}</button>
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
function DirectMessagesTab({ allUserGroups, onRefresh, refreshKey, isMobile = false, onIF, onIB }) {
  const toast = useToast();
  const [dms, setDms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [savedGroupIds, setSavedGroupIds] = useState(new Set());
  const [groupIds, setGroupIds] = useState(new Set());
  const [dmName, setDmName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);

  const load = useCallback(() =>
    api.getMultiGroupDms().then(({ dms }) => setDms([...(dms||[])].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {}), []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const clearSelection = () => { setSelected(null); setDmName(''); setGroupIds(new Set()); setSavedGroupIds(new Set()); setShowDelete(false); };
  const selectDm = (dm) => {
    setShowDelete(false); setAccordionOpen(false); setSelected(dm); setDmName(dm.name);
    const ids = new Set(dm.memberGroupIds||[]); setGroupIds(ids); setSavedGroupIds(ids);
  };

  const handleSave = async () => {
    if (!dmName.trim()) return toast('Name required', 'error');
    if (!selected && groupIds.size < 2) return toast('Select at least two user groups', 'error');
    setSaving(true);
    try {
      if (selected) {
        await api.updateMultiGroupDm(selected.id, { name:dmName.trim(), userGroupIds:[...groupIds] });
        toast('Multi-group DM updated', 'success');
        const freshDms = await api.getMultiGroupDms();
        const fresh = freshDms.dms.find(d => d.id===selected.id);
        if (fresh) { const ids=new Set(fresh.memberGroupIds||[]); setSavedGroupIds(ids); setGroupIds(ids); setSelected(fresh); }
      } else {
        await api.createMultiGroupDm({ name:dmName.trim(), userGroupIds:[...groupIds] });
        toast(`"${dmName.trim()}" created`, 'success');
        clearSelection();
      }
      load(); onRefresh();
    } catch(e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.deleteMultiGroupDm(selected.id); toast('Deleted', 'success'); clearSelection(); load(); onRefresh(); }
    catch(e) { toast(e.message, 'error'); }
    finally { setDeleting(false); }
  };

  const canDelete = selected && savedGroupIds.size === 0;
  const isCreating = !selected;

  return (
    <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:0, height:'100%', minHeight:0, overflow: isMobile ? 'auto' : 'hidden' }}>

      {/* Sidebar — desktop only */}
      {!isMobile && (
        <div style={{ width:220, flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'12px 8px' }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.8px', textTransform:'uppercase', color:'var(--text-tertiary)', marginBottom:8, paddingLeft:4 }}>Multi-Group DMs</div>
          <button onClick={clearSelection} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'var(--radius)', border:'none',
            background:isCreating?'var(--primary-light)':'transparent', color:isCreating?'var(--primary)':'var(--text-secondary)',
            cursor:'pointer', fontWeight:isCreating?600:400, fontSize:13, marginBottom:4 }}>+ New Multi-Group DM</button>
          {dms.map(dm => (
            <button key={dm.id} onClick={() => selectDm(dm)} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'var(--radius)', border:'none',
              background:selected?.id===dm.id?'var(--primary-light)':'transparent', color:selected?.id===dm.id?'var(--primary)':'var(--text-primary)',
              cursor:'pointer', fontWeight:selected?.id===dm.id?600:400, fontSize:13, marginBottom:2 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:26, height:26, borderRadius:6, background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:9, fontWeight:700, flexShrink:0 }}>MG</div>
                <div><div style={{ fontSize:13 }}>{dm.name}</div><div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{dm.group_count} group{dm.group_count!==1?'s':''}</div></div>
              </div>
            </button>
          ))}
          {dms.length===0 && <div style={{ fontSize:13, color:'var(--text-tertiary)', padding:'8px 4px' }}>No multi-group DMs yet</div>}
        </div>
      )}

      {/* Mobile accordion */}
      {isMobile && (
        <div style={{ padding:'8px 8px 4px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={clearSelection} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'var(--radius)', border:'none',
            background:isCreating?'var(--primary-light)':'transparent', color:isCreating?'var(--primary)':'var(--text-secondary)',
            cursor:'pointer', fontWeight:isCreating?600:400, fontSize:13, marginBottom:6 }}>+ New Multi-Group DM</button>
          <button onClick={() => setAccordionOpen(o => !o)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'8px 10px',
            borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer',
            fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom: accordionOpen ? 4 : 0 }}>
            <span>Edit Existing</span>
            <span style={{ fontSize:10, opacity:0.6 }}>{accordionOpen ? '▲' : '▼'}</span>
          </button>
          {accordionOpen && (
            <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
              {dms.map(dm => (
                <button key={dm.id} onClick={() => selectDm(dm)} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 12px',
                  border:'none', borderBottom:'1px solid var(--border)',
                  background:selected?.id===dm.id?'var(--primary-light)':'transparent', color:selected?.id===dm.id?'var(--primary)':'var(--text-primary)',
                  cursor:'pointer', fontWeight:selected?.id===dm.id?600:400, fontSize:13 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:22, height:22, borderRadius:5, background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:8, fontWeight:700, flexShrink:0 }}>MG</div>
                    <div><div style={{ fontSize:13 }}>{dm.name}</div><div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{dm.group_count} group{dm.group_count!==1?'s':''}</div></div>
                  </div>
                </button>
              ))}
              {dms.length===0 && <div style={{ fontSize:13, color:'var(--text-tertiary)', padding:'8px 12px' }}>No multi-group DMs yet</div>}
            </div>
          )}
        </div>
      )}

      <div style={{ flex:1, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '16px 12px' : '16px 24px' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:18, maxWidth: isMobile ? '100%' : 520 }}>
          <div>
            <label className="settings-section-label">DM Name</label>
            <input className="input" value={dmName} onChange={e => setDmName(e.target.value)} autoComplete="off" placeholder="e.g. Coaches + Players" style={{ marginTop:6 }} onFocus={onIF} onBlur={onIB} />
          </div>
          <div>
            <label className="settings-section-label">Member Groups</label>
            <p style={{ fontSize:12, color:'var(--text-tertiary)', margin:'4px 0 8px' }}>Select two or more user groups. All their members get access to this conversation.</p>
            <GroupCheckList allGroups={allUserGroups} selectedIds={groupIds} onChange={setGroupIds} />
            <p style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:5 }}>{groupIds.size} group{groupIds.size!==1?'s':''} selected</p>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving?'Saving…':isCreating?'Create Multi-Group DM':'Save Changes'}</button>
            {!isCreating && <button className="btn btn-secondary btn-sm" onClick={clearSelection}>Cancel</button>}
            {!isCreating && (
              <button className="btn btn-sm" style={{ marginLeft:'auto', background:canDelete?'var(--error)':'var(--surface-variant)', color:canDelete?'white':'var(--text-tertiary)', cursor:canDelete?'pointer':'not-allowed' }}
                onClick={canDelete ? () => setShowDelete(true) : undefined} disabled={!canDelete}
                title={canDelete?'Delete':'Remove all member groups first'}>Delete</button>
            )}
          </div>
          {showDelete && (
            <div style={{ background:'#fce8e6', border:'1px solid #f5c6c2', borderRadius:'var(--radius)', padding:'14px 16px' }}>
              <p style={{ fontSize:13, color:'var(--error)', marginBottom:12 }}>Delete <strong>{selected?.name}</strong>? Also deletes the associated DM group.</p>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-sm" style={{ background:'var(--error)', color:'white' }} onClick={handleDelete} disabled={deleting}>{deleting?'Deleting…':'Yes, Delete'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowDelete(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── U2U Restrictions tab ──────────────────────────────────────────────────────
function U2URestrictionsTab({ allUserGroups, isMobile = false, onIF, onIB }) {
  const toast = useToast();
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [savedBlockedIds, setSavedBlockedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [accordionOpen, setAccordionOpen] = useState(true);
  // Map of groupId → number of restrictions (for showing dots in sidebar)
  const [restrictionCounts, setRestrictionCounts] = useState({});

  // Load restriction counts for all groups on mount and after saves
  const loadAllCounts = useCallback(async () => {
    const counts = {};
    for (const g of allUserGroups) {
      try {
        const { blockedGroupIds } = await api.getGroupRestrictions(g.id);
        counts[g.id] = blockedGroupIds.length;
      } catch { counts[g.id] = 0; }
    }
    setRestrictionCounts(counts);
  }, [allUserGroups]);

  useEffect(() => { if (allUserGroups.length > 0) loadAllCounts(); }, [allUserGroups]);

  const loadRestrictions = async (group) => {
    setLoading(true);
    try {
      const { blockedGroupIds } = await api.getGroupRestrictions(group.id);
      const blocked = new Set(blockedGroupIds.map(Number));
      setBlockedIds(blocked);
      setSavedBlockedIds(blocked);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const selectGroup = (g) => {
    setSelectedGroup(g);
    setSearch('');
    setAccordionOpen(false);
    loadRestrictions(g);
  };

  const clearSelection = () => {
    setSelectedGroup(null);
    setBlockedIds(new Set());
    setSavedBlockedIds(new Set());
  };

  const toggleGroup = (id) => {
    setBlockedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setGroupRestrictions(selectedGroup.id, [...blockedIds]);
      setSavedBlockedIds(new Set(blockedIds));
      toast('Restrictions saved', 'success');
      loadAllCounts();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const isDirty = [...blockedIds].some(id => !savedBlockedIds.has(id)) ||
                  [...savedBlockedIds].some(id => !blockedIds.has(id));

  // Other groups (excluding the selected group itself)
  const otherGroups = allUserGroups.filter(g => g.id !== selectedGroup?.id);
  const filteredGroups = search.trim()
    ? otherGroups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
    : otherGroups;

  const u2uGroupButton = (g) => {
    const hasRestrictions = g.id === selectedGroup?.id ? blockedIds.size > 0 : (restrictionCounts[g.id] || 0) > 0;
    return (
      <button key={g.id} onClick={() => selectGroup(g)} style={{
        display:'block', width:'100%', textAlign:'left', padding:'8px 10px',
        borderRadius:'var(--radius)', border:'none',
        background: selectedGroup?.id===g.id ? 'var(--primary-light)' : 'transparent',
        color: selectedGroup?.id===g.id ? 'var(--primary)' : 'var(--text-primary)',
        cursor:'pointer', fontWeight: selectedGroup?.id===g.id ? 600 : 400, fontSize:13, marginBottom:2,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:26, height:26, borderRadius:6, background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:9, fontWeight:700, flexShrink:0 }}>UG</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.name}</div>
            <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{g.member_count} member{g.member_count!==1?'s':''}</div>
          </div>
          {hasRestrictions && (
            <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--error)', flexShrink:0 }} title="Has U2U restrictions" />
          )}
        </div>
      </button>
    );
  };

  return (
    <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:0, height:'100%', minHeight:0, overflow: isMobile ? 'auto' : 'hidden' }}>

      {/* Group selector — desktop sidebar */}
      {!isMobile && (
        <div style={{ width:220, flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'12px 8px' }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.8px', textTransform:'uppercase', color:'var(--text-tertiary)', marginBottom:8, paddingLeft:4 }}>
            Select Group
          </div>
          {allUserGroups.map(g => u2uGroupButton(g))}
          {allUserGroups.length === 0 && (
            <div style={{ fontSize:13, color:'var(--text-tertiary)', padding:'8px 4px' }}>No user groups yet</div>
          )}
        </div>
      )}

      {/* Mobile accordion — expanded by default, collapses on selection */}
      {isMobile && (
        <div style={{ padding:'8px 8px 4px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={() => setAccordionOpen(o => !o)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'8px 10px',
            borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer',
            fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom: accordionOpen ? 4 : 0 }}>
            <span>Select Group</span>
            <span style={{ fontSize:10, opacity:0.6 }}>{accordionOpen ? '▲' : '▼'}</span>
          </button>
          {accordionOpen && (
            <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
              {allUserGroups.map(g => {
                const hasRestrictions = g.id === selectedGroup?.id ? blockedIds.size > 0 : (restrictionCounts[g.id] || 0) > 0;
                return (
                  <button key={g.id} onClick={() => selectGroup(g)} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 12px',
                    border:'none', borderBottom:'1px solid var(--border)',
                    background:selectedGroup?.id===g.id?'var(--primary-light)':'transparent', color:selectedGroup?.id===g.id?'var(--primary)':'var(--text-primary)',
                    cursor:'pointer', fontWeight:selectedGroup?.id===g.id?600:400, fontSize:13 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:22, height:22, borderRadius:5, background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:8, fontWeight:700, flexShrink:0 }}>UG</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.name}</div>
                        <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{g.member_count} member{g.member_count!==1?'s':''}</div>
                      </div>
                      {hasRestrictions && <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--error)', flexShrink:0 }} />}
                    </div>
                  </button>
                );
              })}
              {allUserGroups.length === 0 && <div style={{ fontSize:13, color:'var(--text-tertiary)', padding:'8px 12px' }}>No user groups yet</div>}
            </div>
          )}
        </div>
      )}

      {/* Restriction editor */}
      <div style={{ flex:1, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '16px 12px' : '16px 24px' }}>
        {!selectedGroup ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            height:'100%', color:'var(--text-tertiary)', gap:12, textAlign:'center' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <div>
              <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>Select a group</div>
              <div style={{ fontSize:13 }}>Choose a user group from the left to configure its DM restrictions.</div>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: isMobile ? '100%' : 540 }}>
            {/* Header */}
            <div style={{ marginBottom:20 }}>
              <h3 style={{ fontSize:16, fontWeight:700, margin:'0 0 6px' }}>{selectedGroup.name}</h3>
              <p style={{ fontSize:13, color:'var(--text-secondary)', margin:0, lineHeight:1.5 }}>
                Members of <strong>{selectedGroup.name}</strong> can initiate 1-to-1 direct messages with members of all <strong>checked</strong> groups.
              </p>
            </div>

            {/* Info banner if restrictions exist */}
            {blockedIds.size > 0 && (
              <div style={{ padding:'10px 14px', background:'#fef3c7', border:'1px solid #fbbf24',
                borderRadius:'var(--radius)', fontSize:13, color:'#92400e', marginBottom:16,
                display:'flex', alignItems:'center', gap:8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span><strong>{blockedIds.size}</strong> group{blockedIds.size!==1?'s are':' is'} currently blocked from receiving DMs initiated by <strong>{selectedGroup.name}</strong> members.</span>
              </div>
            )}

            {/* Search + group list */}
            <div style={{ marginBottom:12 }}>
              <label className="settings-section-label" style={{ marginBottom:6, display:'block' }}>
                Allowed Groups <span style={{ fontWeight:400, color:'var(--text-tertiary)' }}>({otherGroups.length - blockedIds.size} of {otherGroups.length} allowed)</span>
              </label>
              <input className="input" placeholder="Search groups…" value={search}
                onChange={e => setSearch(e.target.value)} autoComplete="off" style={{ marginBottom:8 }}
                onFocus={onIF} onBlur={onIB} />
            </div>

            {loading ? (
              <div style={{ padding:32, textAlign:'center' }}><div className="spinner" /></div>
            ) : (
              <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', marginBottom:16 }}>
                {filteredGroups.length === 0 ? (
                  <div style={{ padding:16, textAlign:'center', color:'var(--text-tertiary)', fontSize:13 }}>
                    {search ? 'No groups match your search.' : 'No other groups exist.'}
                  </div>
                ) : (
                  filteredGroups.map((g, i) => {
                    const isBlocked = blockedIds.has(g.id);
                    return (
                      <label key={g.id} style={{
                        display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
                        borderBottom: i < filteredGroups.length-1 ? '1px solid var(--border)' : 'none',
                        cursor:'pointer', background: isBlocked ? '#fef9f0' : 'transparent',
                        transition:'background 0.1s',
                      }}>
                        <input type="checkbox" checked={!isBlocked}
                          onChange={() => toggleGroup(g.id)}
                          style={{ accentColor:'var(--primary)', width:16, height:16, flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:500, color: isBlocked ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                            {g.name}
                            {isBlocked && <span style={{ marginLeft:8, fontSize:11, color:'var(--warning)', fontWeight:600 }}>BLOCKED</span>}
                          </div>
                          <div style={{ fontSize:12, color:'var(--text-tertiary)' }}>{g.member_count} member{g.member_count!==1?'s':''}</div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            )}

            {/* Quick actions */}
            <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
              <button className="btn btn-secondary btn-sm"
                onClick={() => setBlockedIds(new Set())}>
                Allow All
              </button>
              <button className="btn btn-secondary btn-sm"
                onClick={() => setBlockedIds(new Set(otherGroups.map(g => g.id)))}>
                Block All
              </button>
            </div>

            {/* Save */}
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !isDirty}>
                {saving ? 'Saving…' : 'Save Restrictions'}
              </button>
              {isDirty && (
                <button className="btn btn-secondary btn-sm"
                  onClick={() => setBlockedIds(new Set(savedBlockedIds))}>
                  Discard Changes
                </button>
              )}
              {!isDirty && !saving && (
                <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>No unsaved changes</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const SIDEBAR_W = 320;

export default function GroupManagerPage({ isMobile = false, onProfile, onHelp, onAbout }) {
  const [tab, setTab] = useState('all');
  const [allUsers, setAllUsers] = useState([]);
  const [allUserGroups, setAllUserGroups] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [playersGroupId, setPlayersGroupId] = useState(null);
  const onIF = () => setInputFocused(true);
  const onIB = () => setInputFocused(false);
  const onRefresh = () => setRefreshKey(k => k+1);

  useEffect(() => {
    api.searchUsers('').then(({ users }) => setAllUsers(users.filter(u => u.status==='active' && !u.is_default_admin).sort((a, b) => (a.display_name||a.name).localeCompare(b.display_name||b.name)))).catch(() => {});
    api.getUserGroups().then(({ groups }) => setAllUserGroups([...(groups||[])].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    api.getSettings().then(({ settings }) => {
      const pgid = (settings || []).find(s => s.key === 'feature_players_group_id')?.value;
      setPlayersGroupId(pgid ? parseInt(pgid) : null);
    }).catch(() => {});
  }, [refreshKey]);

  // Nav item helper — matches Schedule page style
  const navItem = (label, key) => (
    <button key={key} onClick={() => setTab(key)}
      style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px',
        borderRadius:'var(--radius)', border:'none',
        background: tab===key ? 'var(--primary-light)' : 'transparent',
        color: tab===key ? 'var(--primary)' : 'var(--text-primary)',
        cursor:'pointer', fontWeight: tab===key ? 600 : 400, fontSize:14, marginBottom:2 }}>
      {label}
    </button>
  );

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

      {/* ── Left panel (desktop only) ── */}
      {!isMobile && (
        <div style={{ width:SIDEBAR_W, flexShrink:0, borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', background:'var(--surface)', overflow:'hidden' }}>
          <div style={{ padding:'16px 16px 0' }}>
            {/* Title — matches Schedule page */}
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
              <span style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>Group Manager</span>
            </div>
            {/* Tab navigation */}
            <div className="section-label" style={{ marginBottom:6 }}>View</div>
            {navItem('User Groups', 'all')}
            {navItem('Multi-Group DMs', 'dm')}
            {navItem('U2U Restrictions', 'u2u')}
          </div>
          <div style={{ flex:1 }} />
          <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
        </div>
      )}

      {/* ── Right panel ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0, background:'var(--background)' }}>

        {/* Mobile tab bar — only shown on mobile */}
        {isMobile && (
          <div style={{ background:'var(--surface)', borderBottom:'1px solid var(--border)', padding:'0 12px', display:'flex', gap:6, height:48, alignItems:'center', flexShrink:0 }}>
            <span style={{ fontWeight:700, fontSize:14, marginRight:4, color:'var(--text-primary)' }}>Groups</span>
            <button className={`btn btn-sm ${tab==='all'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('all')}>Groups</button>
            <button className={`btn btn-sm ${tab==='dm'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('dm')}>Multi-DMs</button>
            <button className={`btn btn-sm ${tab==='u2u'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('u2u')}>U2U</button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex:1, display:'flex', overflow: isMobile ? 'auto' : 'hidden', paddingBottom: isMobile ? 'calc(82px + env(safe-area-inset-bottom, 0px))' : 0 }}>
          {tab==='all' && <AllGroupsTab allUsers={allUsers} onRefresh={onRefresh} isMobile={isMobile} onIF={onIF} onIB={onIB} playersGroupId={playersGroupId} />}
          {tab==='dm'  && <DirectMessagesTab allUserGroups={allUserGroups} onRefresh={onRefresh} refreshKey={refreshKey} isMobile={isMobile} onIF={onIF} onIB={onIB} />}
          {tab==='u2u' && <U2URestrictionsTab allUserGroups={allUserGroups} isMobile={isMobile} onIF={onIF} onIB={onIB} />}
        </div>

        {/* Mobile footer — fixed, hidden when any input is focused (keyboard open) */}
        {isMobile && !inputFocused && (
          <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:20, background:'var(--surface)', borderTop:'1px solid var(--border)' }}>
            <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
          </div>
        )}
      </div>
    </div>
  );
}
