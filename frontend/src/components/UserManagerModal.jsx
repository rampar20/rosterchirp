import { useState, useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../utils/api.js';
import Avatar from './Avatar.jsx';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [], invalid = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^name\s*,/i.test(line)) continue;
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 2 || parts.length > 4) { invalid.push({ line, reason: 'Must have 2–4 comma-separated fields' }); continue; }
    const [name, email, password, role] = parts;
    if (!name || !/\S+\s+\S+/.test(name)) { invalid.push({ line, reason: 'Name must be two words (First Last)' }); continue; }
    if (!email || !isValidEmail(email)) { invalid.push({ line, reason: `Invalid email: "${email}"` }); continue; }
    rows.push({ name: name.trim(), email: email.trim().toLowerCase(), password: (password || '').trim(), role: (role || 'member').trim().toLowerCase() });
  }
  return { rows, invalid };
}

function UserRow({ u, onUpdated }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [resetPw, setResetPw] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState(u.name);
  const [roleWarning, setRoleWarning] = useState(false);

  const handleRole = async (role) => {
    if (!role) { setRoleWarning(true); return; }
    setRoleWarning(false);
    try { await api.updateRole(u.id, role); toast('Role updated', 'success'); onUpdated(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const handleResetPw = async () => {
    if (!resetPw || resetPw.length < 6) return toast('Min 6 characters', 'error');
    try { await api.resetPassword(u.id, resetPw); toast('Password reset', 'success'); setShowReset(false); setResetPw(''); onUpdated(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const handleSaveName = async () => {
    if (!nameVal.trim()) return toast('Name cannot be empty', 'error');
    try {
      const { name } = await api.updateName(u.id, nameVal.trim());
      toast(name !== nameVal.trim() ? `Saved as "${name}"` : 'Name updated', 'success');
      setEditName(false); onUpdated();
    } catch (e) { toast(e.message, 'error'); }
  };

  const handleSuspend = async () => {
    if (!confirm(`Suspend ${u.name}?`)) return;
    try { await api.suspendUser(u.id); toast('User suspended', 'success'); onUpdated(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const handleActivate = async () => {
    try { await api.activateUser(u.id); toast('User activated', 'success'); onUpdated(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const handleDelete = async () => {
    if (u.role === 'admin') return toast('Demote to member before deleting an admin', 'error');
    if (!confirm(`Delete ${u.name}? Their messages will remain but they cannot log in.`)) return;
    try { await api.deleteUser(u.id); toast('User deleted', 'success'); onUpdated(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Row header — always visible */}
      <button
        onClick={() => { setOpen(o => !o); setShowReset(false); setEditName(false); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', color: 'var(--text-primary)',
        }}
      >
        <Avatar user={u} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</span>
            <span className={`role-badge role-${u.role}`}>{u.role}</span>
            {u.status !== 'active' && <span className="role-badge status-suspended">{u.status}</span>}
            {!!u.is_default_admin && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Default Admin</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
            Last online: {(() => {
              if (!u.last_online) return 'Never';
              const d = new Date(u.last_online + 'Z');
              const today = new Date(); today.setHours(0,0,0,0);
              const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
              d.setHours(0,0,0,0);
              if (d >= today) return 'Today';
              if (d >= yesterday) return 'Yesterday';
              return d.toISOString().slice(0,10);
            })()}
          </div>
          {!!u.must_change_password && <div className="text-xs" style={{ color: 'var(--warning)' }}>⚠ Must change password</div>}
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none', color: 'var(--text-tertiary)' }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Accordion panel */}
      {open && !u.is_default_admin && (
        <div style={{ padding: '4px 4px 14px 44px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Edit name */}
          {editName ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: 13, padding: '5px 8px' }}
                value={nameVal}
                onChange={e => setNameVal(e.target.value)} autoComplete="new-password" onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setEditName(false); setNameVal(u.name); } }} />
              <button className="btn btn-primary btn-sm" onClick={handleSaveName}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditName(false); setNameVal(u.name); }}>✕</button>
            </div>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={() => { setEditName(true); setShowReset(false); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Name
            </button>
          )}

          {/* Role selector */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <select
              value={roleWarning ? '' : u.role}
              onChange={e => handleRole(e.target.value)}
              className="input"
              style={{ width: 140, padding: '5px 8px', fontSize: 13, borderColor: roleWarning ? '#e53935' : undefined }}
            >
              <option value="" disabled>User Role</option>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            {roleWarning && <span style={{ fontSize: 12, color: '#e53935' }}>Role Required</span>}
          </div>

          {/* Reset password */}
          {showReset ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: 13, padding: '5px 8px' }}
                type="text"
                placeholder="New password (min 6)"
                value={resetPw}
                onChange={e => setResetPw(e.target.value)} autoComplete="new-password" onKeyDown={e => { if (e.key === 'Enter') handleResetPw(); if (e.key === 'Escape') { setShowReset(false); setResetPw(''); } }} />
              <button className="btn btn-primary btn-sm" onClick={handleResetPw}>Set</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowReset(false); setResetPw(''); }}>✕</button>
            </div>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={() => { setShowReset(true); setEditName(false); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Reset Password
            </button>
          )}

          {/* Suspend / Activate / Delete */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {u.status === 'active' ? (
              <button className="btn btn-secondary btn-sm" onClick={handleSuspend}>Suspend</button>
            ) : u.status === 'suspended' ? (
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--success)' }} onClick={handleActivate}>Activate</button>
            ) : null}
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete User</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UserManagerModal({ onClose }) {
  const isMobile = window.innerWidth < 768;
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('users');
  // Reset bulk tab if somehow active on mobile
  useEffect(() => { if(isMobile && tab === 'bulk') setTab('users'); }, [isMobile]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });

  const [csvFile, setCsvFile] = useState(null);
  const [csvRows, setCsvRows] = useState([]);
  const [csvInvalid, setCsvInvalid] = useState([]);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const fileRef = useRef(null);
  const [userPass, setUserPass] = useState('user@1234');

  const [loadError, setLoadError] = useState('');
  const load = async () => {
    setLoadError('');
    setLoading(true);
    try {
      const { users } = await api.getUsers();
      setUsers(users || []);
    } catch (e) {
      setLoadError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    api.getSettings().then(({ settings }) => {
      if (settings.user_pass) setUserPass(settings.user_pass);
    }).catch(() => {});
  }, []);

  const filtered = users.filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim()) return toast('Name and email are required', 'error');
    if (!isValidEmail(form.email)) return toast('Invalid email address', 'error');
    if (!/\S+\s+\S+/.test(form.name.trim())) return toast('Name must be two words (First Last)', 'error');
    setCreating(true);
    try {
      await api.createUser(form);
      toast('User created', 'success');
      setForm({ name: '', email: '', password: '', role: 'member' });
      setTab('users');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setBulkResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows, invalid } = parseCSV(ev.target.result);
      setCsvRows(rows);
      setCsvInvalid(invalid);
    };
    reader.readAsText(file);
  };

  const handleBulkImport = async () => {
    if (!csvRows.length) return;
    setBulkLoading(true);
    try {
      const result = await api.bulkUsers(csvRows);
      setBulkResult(result);
      setCsvRows([]); setCsvFile(null); setCsvInvalid([]);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 600, width: '100%' }}>
        {/* form wrapper suppresses Chrome Android's autofill chip bar; autoComplete="off"
            on individual inputs is ignored by Chrome but respected on the form element */}
        <form autoComplete="off" onSubmit={e => e.preventDefault()}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>User Manager</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex gap-2" style={{ marginBottom: 20 }}>
          <button className={`btn btn-sm ${tab === 'users' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('users')}>All Users ({users.length})</button>
          <button className={`btn btn-sm ${tab === 'create' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('create')}>+ Create User</button>
          {!isMobile && <button className={`btn btn-sm ${tab === 'bulk' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('bulk')}>Bulk Import CSV</button>}
        </div>

        {/* Users list — accordion */}
        {tab === 'users' && (
          <>
            <input className="input" style={{ marginBottom: 12 }} placeholder="Search users…" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={search} onChange={e => setSearch(e.target.value)} />
            {loading ? (
              <div className="flex justify-center" style={{ padding: 40 }}><div className="spinner" /></div>
            ) : loadError ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--error)' }}>
                <div style={{ marginBottom: 10 }}>⚠ {loadError}</div>
                <button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); load(); }}>Retry</button>
              </div>
            ) : (
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {filtered.map(u => (
                  <UserRow key={u.id} u={u} onUpdated={load} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Create user */}
        {tab === 'create' && (
          <div className="flex-col gap-3">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Full Name <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(First Last)</span></label>
                <input className="input" placeholder="Jane Smith" autoComplete="new-password" autoCorrect="off" autoCapitalize="words" spellCheck={false} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Email</label>
                <input className="input" type="email" placeholder="jane@example.com" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Temp Password <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(blank = {userPass || 'USER_PASS'})</span></label>
                <input className="input" type="text" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
              </div>
              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Role</label>
                <select className="input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>User must change password on first login. Duplicate names get a number suffix automatically.</p>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create User'}</button>
          </div>
        )}

        {/* Bulk import */}
        {tab === 'bulk' && (
          <div className="flex-col gap-4">
            <div className="card" style={{ background: 'var(--background)', border: '1px dashed var(--border)' }}>
              <p className="text-sm font-medium" style={{ marginBottom: 6 }}>CSV Format</p>
              <code style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', background: 'var(--surface)', padding: 8, borderRadius: 4, border: '1px solid var(--border)', whiteSpace: 'pre' }}>name,email,password,role{'\n'}Jane Smith,jane@company.local,,member{'\n'}Bob Jones,bob@company.com,TempPass1,admin</code>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)', marginTop: 8 }}>
                Name and email are required. If left blank, Temp Password defaults to <strong>{userPass}</strong>, Role defaults to member. Lines with duplicate emails are skipped. Duplicate names get a number suffix.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0, flexShrink: 0 }}>
                Select CSV File
                <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFileSelect} />
              </label>
              {csvFile && (
                <span className="text-sm" style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {csvFile.name}
                  {csvRows.length > 0 && <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>({csvRows.length} valid)</span>}
                </span>
              )}
              {csvRows.length > 0 && (
                <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={handleBulkImport} disabled={bulkLoading}>
                  {bulkLoading ? 'Creating…' : `Create ${csvRows.length} User${csvRows.length !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>

            {csvInvalid.length > 0 && (
              <div style={{ background: 'rgba(229,57,53,0.07)', border: '1px solid #e53935', borderRadius: 'var(--radius)', padding: 10 }}>
                <p className="text-sm font-medium" style={{ color: '#e53935', marginBottom: 6 }}>{csvInvalid.length} line{csvInvalid.length !== 1 ? 's' : ''} skipped — invalid format</p>
                <div style={{ maxHeight: 100, overflowY: 'auto' }}>
                  {csvInvalid.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, padding: '2px 0', color: 'var(--text-secondary)' }}>
                      <code style={{ fontSize: 11 }}>{e.line}</code>
                      <span style={{ color: '#e53935', marginLeft: 8 }}>— {e.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {bulkResult && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12 }}>
                <p className="text-sm font-medium" style={{ color: 'var(--success, #2e7d32)', marginBottom: bulkResult.skipped.length ? 8 : 0 }}>
                  ✓ {bulkResult.created.length} user{bulkResult.created.length !== 1 ? 's' : ''} created successfully
                </p>
                {bulkResult.skipped.length > 0 && (
                  <>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>{bulkResult.skipped.length} account{bulkResult.skipped.length !== 1 ? 's' : ''} skipped:</p>
                    <div style={{ maxHeight: 112, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                      {bulkResult.skipped.map((s, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: i < bulkResult.skipped.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13, gap: 12 }}>
                          <span style={{ color: 'var(--text-primary)' }}>{s.email}</span>
                          <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{s.reason}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setBulkResult(null)}>Dismiss</button>
              </div>
            )}
          </div>
        )}
        </form>
      </div>
    </div>
  );
}
