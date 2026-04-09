import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import Avatar from './Avatar.jsx';

// ── Shared back header ────────────────────────────────────────────────────────
function Header({ title, onBack, right }) {
  return (
    <div style={{ display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:'var(--surface)',borderBottom:'1px solid var(--border)',flexShrink:0 }}>
      {onBack && (
        <button onClick={onBack} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',display:'flex',alignItems:'center',padding:2 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      )}
      <span style={{ fontWeight:700,fontSize:16,flex:1 }}>{title}</span>
      {right}
    </div>
  );
}

// ── Members screen ────────────────────────────────────────────────────────────
function MembersScreen({ group, allUsers, onBack }) {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadMembers = async () => {
    try {
      const r = await api.getUserGroup(group.id);
      setMembers(r.members || []);
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadMembers(); }, [group.id]);

  const [search, setSearch] = useState('');
  const memberIds = new Set(members.map(m => m.id));
  const filteredUsers = search.trim()
    ? allUsers.filter(u => (u.display_name||u.name).toLowerCase().includes(search.toLowerCase()))
    : allUsers;

  const toggle = async (user) => {
    const nowMember = memberIds.has(user.id);
    // Optimistic update
    if(nowMember) setMembers(prev => prev.filter(m => m.id !== user.id));
    else setMembers(prev => [...prev, user]);
    try {
      const newIds = nowMember
        ? members.filter(m => m.id !== user.id).map(m => m.id)
        : [...members.map(m => m.id), user.id];
      await api.updateUserGroupMembers(group.id, newIds);
    } catch(e) {
      toast(e.message, 'error');
      loadMembers(); // revert on error
    }
  };

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100%',background:'var(--background)' }}>
      <Header
        title={group.name}
        onBack={onBack}
        right={<span style={{ fontSize:13,color:'var(--text-tertiary)' }}>{members.length} member{members.length!==1?'s':''}</span>} />
      {loading ? (
        <div style={{ textAlign:'center',padding:40,color:'var(--text-tertiary)' }}>Loading…</div>
      ) : (
        <div style={{ flex:1,overflowY:'auto' }}>
          <div style={{ padding:'10px 16px 4px' }}>
            <div style={{ position:'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                value={search} onChange={e => setSearch(e.target.value)} autoComplete="new-password" placeholder="Search users…"
                autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                style={{width:'100%',padding:'8px 10px 8px 32px',border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--background)',color:'var(--text-primary)',fontSize:14,boxSizing:'border-box'}} />
            </div>
          </div>
          <div style={{ padding:'4px 16px 4px',fontSize:11,fontWeight:700,color:'var(--text-tertiary)',textTransform:'uppercase',letterSpacing:'0.5px' }}>
            {search ? `${filteredUsers.length} result${filteredUsers.length!==1?'s':''}` : 'All Users'}
          </div>
          {filteredUsers.map(u => {
            const isMember = memberIds.has(u.id);
            return (
              <div key={u.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'11px 16px',borderBottom:'1px solid var(--border)' }}>
                <Avatar user={u} size="sm"/>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:15,fontWeight:500,truncate:true }}>{u.display_name||u.name}</div>
                  <div style={{ fontSize:12,color:'var(--text-tertiary)' }}>{u.role}</div>
                </div>
                <button onClick={()=>toggle(u)} style={{ padding:'7px 14px',borderRadius:20,border:`1px solid ${isMember?'var(--error)':'var(--primary)'}`,background:'transparent',color:isMember?'var(--error)':'var(--primary)',fontSize:13,fontWeight:600,cursor:'pointer',flexShrink:0 }}>
                  {isMember ? 'Remove' : 'Add'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Multi-Group DM screen ─────────────────────────────────────────────────────
function MultiGroupDmsScreen({ userGroups, onBack }) {
  const toast = useToast();
  const [dms, setDms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.getMultiGroupDms();
      setDms(r.dms || []);
    } catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if(!newName.trim() || selectedGroups.size < 2) return toast('Name and at least 2 groups required','error');
    setSaving(true);
    try {
      await api.createMultiGroupDm({ name: newName.trim(), userGroupIds: [...selectedGroups] });
      setNewName(''); setSelectedGroups(new Set()); setCreating(false); load();
    } catch(e) { toast(e.message,'error'); }
    finally { setSaving(false); }
  };

  const deleteDm = async (dm) => {
    if(!confirm(`Delete "${dm.name}"?`)) return;
    try { await api.deleteMultiGroupDm(dm.id); load(); } catch(e) { toast(e.message,'error'); }
  };

  const toggleGrp = id => setSelectedGroups(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100%',background:'var(--background)' }}>
      <Header
        title="Multi-Group DMs"
        onBack={onBack}
        right={<button onClick={()=>setCreating(v=>!v)} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--primary)',fontSize:24,lineHeight:1,padding:0 }}>+</button>} />
      {creating && (
        <div style={{ padding:16,background:'var(--surface)',borderBottom:'1px solid var(--border)' }}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} autoComplete="new-password" placeholder="DM name…" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ width:'100%',padding:'9px 12px',border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--background)',color:'var(--text-primary)',fontSize:15,marginBottom:10,boxSizing:'border-box' }}/>
          <div style={{ fontSize:12,color:'var(--text-tertiary)',marginBottom:6 }}>Select groups (min 2):</div>
          {userGroups.map(g=>(
            <label key={g.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)',cursor:'pointer' }}>
              <input type="checkbox" checked={selectedGroups.has(g.id)} onChange={()=>toggleGrp(g.id)} style={{ width:18,height:18,accentColor:'var(--primary)' }}/>
              <span style={{ fontSize:15 }}>{g.name}</span>
            </label>
          ))}
          <div style={{ display:'flex',gap:10,marginTop:12 }}>
            <button onClick={create} disabled={saving||!newName.trim()||selectedGroups.size<2} style={{ flex:1,padding:'10px',background:'var(--primary)',color:'white',border:'none',borderRadius:'var(--radius)',fontSize:14,fontWeight:600,cursor:'pointer',opacity:saving?0.6:1 }}>{saving?'Creating…':'Create'}</button>
            <button onClick={()=>{setCreating(false);setNewName('');setSelectedGroups(new Set());}} style={{ padding:'10px 16px',background:'none',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text-secondary)',cursor:'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ flex:1,overflowY:'auto' }}>
        {loading && <div style={{ textAlign:'center',padding:40,color:'var(--text-tertiary)' }}>Loading…</div>}
        {!loading && dms.length===0 && <div style={{ textAlign:'center',padding:60,color:'var(--text-tertiary)',fontSize:14 }}>No multi-group DMs yet. Tap + to create one.</div>}
        {dms.map(dm=>(
          <div key={dm.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'14px 16px',borderBottom:'1px solid var(--border)' }}>
            <div style={{ width:42,height:42,borderRadius:10,background:'var(--primary)',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:700,fontSize:12,flexShrink:0 }}>MG</div>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontSize:15,fontWeight:600 }}>{dm.name}</div>
              <div style={{ fontSize:12,color:'var(--text-tertiary)' }}>{dm.group_count} group{dm.group_count!==1?'s':''}</div>
            </div>
            <button onClick={()=>deleteDm(dm)} style={{ padding:'6px 12px',border:'1px solid var(--error)',borderRadius:16,background:'transparent',color:'var(--error)',fontSize:13,cursor:'pointer' }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Group list screen ─────────────────────────────────────────────────────────
export default function MobileGroupManager({ onClose }) {
  const toast = useToast();
  const [groups, setGroups] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [screen, setScreen] = useState('list'); // list | members | mgdms
  const [activeGroup, setActiveGroup] = useState(null);
  const [tab, setTab] = useState('groups'); // groups | mgdms

  const load = async () => {
    try {
      const [ug, us] = await Promise.all([api.getUserGroups(), api.getUsers()]);
      setGroups(ug.groups || []);
      setAllUsers(us.users || []);
    } catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if(screen === 'members' && activeGroup) return <MembersScreen group={activeGroup} allUsers={allUsers} onBack={()=>{setScreen('list');load();}}/>;
  if(screen === 'mgdms') return <MultiGroupDmsScreen userGroups={groups} onBack={()=>setScreen('list')}/>;

  const createGroup = async () => {
    if(!newName.trim()) return;
    setSaving(true);
    try {
      await api.createUserGroup({ name: newName.trim() });
      setNewName(''); setCreating(false); load();
    } catch(e) { toast(e.message,'error'); }
    finally { setSaving(false); }
  };

  const deleteGroup = async (g, e) => {
    e.stopPropagation();
    if(!confirm(`Delete "${g.name}"?`)) return;
    try { await api.deleteUserGroup(g.id); load(); } catch(e2) { toast(e2.message,'error'); }
  };

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100%',background:'var(--background)' }}>
      <Header
        title="Group Manager"
        onBack={onClose}
        right={tab==='groups' && <button onClick={()=>setCreating(v=>!v)} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--primary)',fontSize:24,lineHeight:1,padding:0 }}>+</button>} />

      {/* Tab bar */}
      <div style={{ display:'flex',background:'var(--surface)',borderBottom:'1px solid var(--border)',flexShrink:0 }}>
        {[['groups','All Groups'],['mgdms','Multi-Group DMs']].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{ flex:1,padding:'11px 8px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:tab===key?'var(--primary)':'var(--text-secondary)',borderBottom:tab===key?'2px solid var(--primary)':'2px solid transparent' }}>{label}</button>
        ))}
      </div>

      {tab === 'mgdms' && <MultiGroupDmsScreen userGroups={groups} onBack={()=>setTab('groups')}/>}

      {tab === 'groups' && (
        <>
          {creating && (
            <div style={{ padding:'12px 16px',background:'var(--surface)',borderBottom:'1px solid var(--border)',display:'flex',gap:10 }}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} autoComplete="new-password" onKeyDown={e=>e.key==='Enter'&&createGroup()} placeholder="Group name…" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ flex:1,padding:'8px 12px',border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--background)',color:'var(--text-primary)',fontSize:15 }}/>
              <button onClick={createGroup} disabled={saving||!newName.trim()} style={{ padding:'8px 16px',background:'var(--primary)',color:'white',border:'none',borderRadius:'var(--radius)',fontSize:14,fontWeight:600,cursor:'pointer' }}>{saving?'…':'Create'}</button>
              <button onClick={()=>{setCreating(false);setNewName('');}} style={{ padding:'8px',background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',fontSize:18 }}>✕</button>
            </div>
          )}
          <div style={{ flex:1,overflowY:'auto' }}>
            {loading && <div style={{ textAlign:'center',padding:40,color:'var(--text-tertiary)' }}>Loading…</div>}
            {!loading && groups.length===0 && <div style={{ textAlign:'center',padding:60,color:'var(--text-tertiary)',fontSize:14 }}>No groups yet. Tap + to create one.</div>}
            {groups.map(g=>(
              <div key={g.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'14px 16px',borderBottom:'1px solid var(--border)',cursor:'pointer' }} onClick={()=>{setActiveGroup(g);setScreen('members');}}>
                <div style={{ width:42,height:42,borderRadius:10,background:'var(--primary)',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:700,fontSize:14,flexShrink:0 }}>
                  {g.name.substring(0,2).toUpperCase()}
                </div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:15,fontWeight:600 }}>{g.name}</div>
                  <div style={{ fontSize:12,color:'var(--text-tertiary)' }}>{g.member_count||0} member{g.member_count!==1?'s':''}</div>
                </div>
                <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                  <button onClick={e=>deleteGroup(g,e)} style={{ padding:'6px 12px',border:'1px solid var(--error)',borderRadius:16,background:'transparent',color:'var(--error)',fontSize:13,cursor:'pointer' }}>Delete</button>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
