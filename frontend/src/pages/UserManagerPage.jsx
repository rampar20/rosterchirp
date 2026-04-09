import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../utils/api.js';
import Avatar from '../components/Avatar.jsx';
import UserFooter from '../components/UserFooter.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

const SIDEBAR_W = 320;

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidPhone(p) {
  if (!p || !p.trim()) return true;
  const digits = p.replace(/[\s\-\(\)\+\.x#]/g, '');
  return /^\d{7,15}$/.test(digits);
}

// Format: email,firstname,lastname,dob,password,role,usergroup  (exactly 6 commas / 7 fields)
function parseCSV(text, ignoreFirstRow, allUserGroups, loginType) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [], invalid = [];
  const groupMap = new Map((allUserGroups || []).map(g => [g.name.toLowerCase(), g]));
  const validRoles = ['member', 'manager', 'admin'];
  const requireDob = loginType === 'mixed_age';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip first row if checkbox set OR if it looks like a header (first field = 'email')
    if (i === 0 && (ignoreFirstRow || /^e-?mail$/i.test(line.split(',')[0].trim()))) continue;

    const parts = line.split(',');
    if (parts.length !== 7) { invalid.push({ line, reason: `Must have exactly 6 commas (has ${parts.length - 1})` }); continue; }
    const [email, firstName, lastName, dobRaw, password, roleRaw, usergroupRaw] = parts.map(p => p.trim());

    if (!email || !isValidEmail(email)) { invalid.push({ line, reason: `Invalid email: "${email || '(blank)'}"` }); continue; }
    if (!firstName) { invalid.push({ line, reason: 'First name required' }); continue; }
    if (!lastName)  { invalid.push({ line, reason: 'Last name required' }); continue; }
    if (requireDob && !dobRaw) { invalid.push({ line, reason: 'Date of birth required in Restricted login type' }); continue; }

    const role = validRoles.includes(roleRaw.toLowerCase()) ? roleRaw.toLowerCase() : 'member';
    const matchedGroup = usergroupRaw ? groupMap.get(usergroupRaw.toLowerCase()) : null;

    rows.push({
      email: email.toLowerCase(),
      firstName,
      lastName,
      password,
      dateOfBirth: dobRaw || null,
      role,
      userGroupId: matchedGroup?.id || null,
      userGroupName: usergroupRaw || null,
    });
  }
  return { rows, invalid };
}

function fmtLastLogin(ts) {
  if (!ts) return 'Never';
  const d = new Date(ts); const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  if (dd >= today) return 'Today';
  if (dd >= yesterday) return 'Yesterday';
  return dd.toISOString().slice(0, 10);
}

// ── User Row (accordion list item) ───────────────────────────────────────────
function UserRow({ u, onUpdated, onEdit }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

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
    if (!confirm(`Delete ${u.name}?\n\nThis will:\n• Anonymise their account and free their email for re-use\n• Remove all their messages from conversations\n• Freeze any direct messages they were part of\n• Remove all their group memberships\n\nThis cannot be undone.`)) return;
    try { await api.deleteUser(u.id); toast('User deleted', 'success'); onUpdated(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
          background:'none', border:'none', cursor:'pointer', textAlign:'left', color:'var(--text-primary)' }}>
        <Avatar user={u} size="sm" />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <span style={{ fontWeight:600, fontSize:14, color: u.guardian_approval_required ? 'var(--error)' : 'var(--text-primary)' }}>{u.display_name || u.name}</span>
            {u.display_name && <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>({u.name})</span>}
            <span className={`role-badge role-${u.role}`}>{u.role}</span>
            {u.status !== 'active' && <span className="role-badge status-suspended">{u.status}</span>}
            {!!u.guardian_approval_required && <span className="role-badge" style={{ background:'var(--error)', color:'white' }}>Pending Guardian Approval</span>}
            {!!u.is_default_admin && <span className="text-xs" style={{ color:'var(--text-tertiary)' }}>Default Admin</span>}
          </div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{u.email}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ flexShrink:0, transition:'transform 0.2s', transform:open?'rotate(180deg)':'none', color:'var(--text-tertiary)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && !u.is_default_admin && (
        <div style={{ padding:'6px 12px 12px', display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', fontSize:12, color:'var(--text-tertiary)', paddingBottom:6, borderBottom:'1px solid var(--border)' }}>
            <span>Last Login: <strong style={{ color:'var(--text-secondary)' }}>{fmtLastLogin(u.last_online)}</strong></span>
            {!!u.must_change_password && (
              <span style={{ color:'var(--warning)', fontWeight:600 }}>⚠ Must change password</span>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { setOpen(false); onEdit(u); }}>Edit User</button>
            <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
              {u.status === 'active' ? (
                <button className="btn btn-sm" style={{ background:'var(--warning)', color:'white' }} onClick={handleSuspend}>Suspend</button>
              ) : u.status === 'suspended' ? (
                <button className="btn btn-sm" style={{ background:'var(--success)', color:'white' }} onClick={handleActivate}>Activate</button>
              ) : null}
              <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── User Form (create / edit) ─────────────────────────────────────────────────
function UserForm({ user, userPass, allUserGroups, nonMinorUsers, loginType, onDone, onCancel, isMobile, onIF, onIB }) {
  const toast = useToast();
  const isEdit = !!user;

  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName,  setLastName]  = useState(user?.last_name  || '');
  const [email,     setEmail]     = useState(user?.email      || '');
  const [phone,     setPhone]     = useState(user?.phone      || '');
  const [role,        setRole]        = useState(user?.role            || 'member');
  const [dob,         setDob]         = useState(user?.date_of_birth?.slice(0, 10) || '');
  const [guardianId,  setGuardianId]  = useState(user?.guardian_user_id || '');
  const [password,    setPassword]    = useState('');
  const [pwEnabled, setPwEnabled] = useState(!isEdit);
  const [saving,    setSaving]    = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState(new Set());
  const [origGroupIds,     setOrigGroupIds]     = useState(new Set());

  useEffect(() => {
    if (!isEdit || !user?.id || !allUserGroups?.length) return;
    api.getUserGroupsForUser(user.id)
      .then(({ groupIds }) => {
        const ids = new Set((groupIds || []).map(Number));
        setSelectedGroupIds(ids);
        setOrigGroupIds(ids);
      })
      .catch(() => {});
  }, [isEdit, user?.id]);

  const handleSubmit = async () => {
    if (!isEdit && (!email.trim() || !isValidEmail(email.trim())))
      return toast('Valid email address required', 'error');
    if (!firstName.trim()) return toast('First name is required', 'error');
    if (!lastName.trim())  return toast('Last name is required',  'error');
    if (!isValidPhone(phone)) return toast('Invalid phone number', 'error');
    if (!['member', 'admin', 'manager'].includes(role)) return toast('Role is required', 'error');
    if (isEdit && pwEnabled && (!password || password.length < 6))
      return toast('New password must be at least 6 characters', 'error');

    setSaving(true);
    try {
      if (isEdit) {
        await api.updateUser(user.id, {
          firstName:    firstName.trim(),
          lastName:     lastName.trim(),
          phone:        phone.trim(),
          role,
          dateOfBirth:  dob || undefined,
          guardianUserId: guardianId || undefined,
          ...(pwEnabled && password ? { password } : {}),
        });
        // Sync group memberships: add newly selected, remove deselected
        for (const gId of selectedGroupIds) {
          if (!origGroupIds.has(gId)) await api.addUserToGroup(gId, user.id);
        }
        for (const gId of origGroupIds) {
          if (!selectedGroupIds.has(gId)) await api.removeUserFromGroup(gId, user.id);
        }
        toast('User updated', 'success');
      } else {
        const { user: newUser } = await api.createUser({
          firstName:   firstName.trim(),
          lastName:    lastName.trim(),
          email:       email.trim(),
          phone:       phone.trim(),
          role,
          dateOfBirth: dob || undefined,
          ...(password ? { password } : {}),
        });
        // Add to selected groups
        for (const gId of selectedGroupIds) {
          await api.addUserToGroup(gId, newUser.id);
        }
        toast('User created', 'success');
      }
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const colGrid = isMobile ? '1fr' : '1fr 1fr';
  const lbl = (text, required, note) => (
    <label className="text-sm font-medium" style={{ color:'var(--text-secondary)', display:'block', marginBottom:4 }}>
      {text}
      {required && <span style={{ color:'var(--error)', marginLeft:2 }}>*</span>}
      {note && <span style={{ fontSize:11, color:'var(--text-tertiary)', fontWeight:400, marginLeft:6 }}>{note}</span>}
    </label>
  );

  return (
    <div style={{ maxWidth: isMobile ? '100%' : 580 }}>

      {/* Back + title */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <button onClick={onCancel} className="btn btn-secondary btn-sm"
          style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>
        <span style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>
          {isEdit ? 'Edit User' : 'Create User'}
        </span>
      </div>

      {/* Row 1: Login (email) — full width */}
      <div style={{ marginBottom:12 }}>
        {lbl('Login (email)', !isEdit)}
        <input className="input" type="email" placeholder="user@example.com"
          value={email} onChange={e => setEmail(e.target.value)}
          disabled={isEdit}
          style={{ width:'100%', ...(isEdit ? { opacity:0.6, cursor:'not-allowed' } : {}) }}
          autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck="false" onFocus={onIF} onBlur={onIB} />
      </div>

      {/* Row 2: First Name + Last Name */}
      <div style={{ display:'grid', gridTemplateColumns:colGrid, gap:12, marginBottom:12 }}>
        <div>
          {lbl('First Name', true)}
          <input className="input" placeholder="Jane"
            value={firstName} onChange={e => setFirstName(e.target.value)}
            autoComplete="new-password" autoCapitalize="words" onFocus={onIF} onBlur={onIB} />
        </div>
        <div>
          {lbl('Last Name', true)}
          <input className="input" placeholder="Smith"
            value={lastName} onChange={e => setLastName(e.target.value)}
            autoComplete="new-password" autoCapitalize="words" onFocus={onIF} onBlur={onIB} />
        </div>
      </div>

      {/* Row 3: Phone + Role */}
      <div style={{ display:'grid', gridTemplateColumns:colGrid, gap:12, marginBottom:12 }}>
        <div>
          {lbl('Phone', false, '(optional)')}
          <input className="input" type="tel" placeholder="+1 555 000 0000"
            value={phone} onChange={e => setPhone(e.target.value)}
            autoComplete="new-password" onFocus={onIF} onBlur={onIB} />
        </div>
        <div>
          {lbl('App Role', true)}
          <select className="input" value={role} onChange={e => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      {/* Row 4: DOB + Guardian */}
      <div style={{ display:'grid', gridTemplateColumns:colGrid, gap:12, marginBottom:12 }}>
        <div>
          {lbl('Date of Birth', false, '(optional)')}
          <input className="input" type="text" placeholder="YYYY-MM-DD"
            value={dob} onChange={e => setDob(e.target.value)}
            autoComplete="off" onFocus={onIF} onBlur={onIB} />
        </div>
        {/* Guardian field — shown for all login types except guardian_only (children are aliases there, not users) */}
        {loginType !== 'guardian_only' && (
          <div>
            {lbl('Guardian', false, '(optional)')}
            <div style={{ position:'relative' }}>
              <select className="input" value={guardianId} onChange={e => setGuardianId(e.target.value)}
                style={ user?.guardian_approval_required ? { borderColor:'var(--error)' } : {} }>
                <option value="">— None —</option>
                {(nonMinorUsers || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            {isEdit && user?.guardian_approval_required && (
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
                <span style={{ fontSize:12, color:'var(--error)', fontWeight:600 }}>Pending approval</span>
                <button className="btn btn-sm" style={{ fontSize:12, color:'var(--success)', background:'none', border:'1px solid var(--success)', padding:'2px 8px', cursor:'pointer' }}
                  onClick={async () => { try { await api.approveGuardian(user.id); toast('Approved', 'success'); onDone(); } catch(e) { toast(e.message,'error'); } }}>
                  Approve
                </button>
                <button className="btn btn-sm" style={{ fontSize:12, color:'var(--error)', background:'none', border:'1px solid var(--error)', padding:'2px 8px', cursor:'pointer' }}
                  onClick={async () => { try { await api.denyGuardian(user.id); toast('Denied', 'success'); onDone(); } catch(e) { toast(e.message,'error'); } }}>
                  Deny
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 4b: User Groups */}
      {allUserGroups?.length > 0 && (
        <div style={{ marginBottom:12 }}>
          {lbl('User Groups', false, '(optional)')}
          <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', maxHeight:120, overflowY:'auto', marginTop:6 }}>
            {allUserGroups.map(g => (
              <label key={g.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
                <input type="checkbox"
                  checked={selectedGroupIds.has(g.id)}
                  onChange={() => setSelectedGroupIds(prev => { const n = new Set(prev); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
                  style={{ accentColor:'var(--primary)', width:15, height:15 }} />
                <span style={{ fontSize:13 }}>{g.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Row 5: Password */}
      <div style={{ marginBottom:16 }}>
        {lbl('Password',
          isEdit && pwEnabled,
          isEdit && !pwEnabled ? '(click Reset button to change)' :
          !isEdit ? <>(optional — blank uses <strong>{userPass}</strong> as default)</> : null
        )}
        <div style={{ opacity: pwEnabled ? 1 : 0.55 }}>
          <PasswordInput
            value={password} onChange={e => setPassword(e.target.value)}
            placeholder={isEdit && !pwEnabled ? '••••••••' : 'Min 6 characters'}
            disabled={!pwEnabled}
            autoComplete="new-password"
            onFocus={onIF} onBlur={onIB}
          />
        </div>
      </div>

      {/* Row 6: Buttons */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:10 }}>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
        </button>
        {isEdit && !pwEnabled && (
          <button className="btn btn-sm" style={{ background:'var(--error)', color:'white' }}
            onClick={() => setPwEnabled(true)}>
            Reset Password
          </button>
        )}
        {isEdit && pwEnabled && (
          <button className="btn btn-secondary btn-sm"
            onClick={() => { setPwEnabled(false); setPassword(''); }}>
            Cancel Reset
          </button>
        )}
      </div>

      {/* Row 7 (edit only): Last login + must change password */}
      {isEdit && (
        <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', fontSize:12, color:'var(--text-tertiary)', paddingTop:4, borderTop:'1px solid var(--border)' }}>
          <span>Last Login: <strong style={{ color:'var(--text-secondary)' }}>{fmtLastLogin(user.last_online)}</strong></span>
          {!!user.must_change_password && (
            <span style={{ color:'var(--warning)', fontWeight:600 }}>⚠ Must change password</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bulk Import Form ──────────────────────────────────────────────────────────
function BulkImportForm({ userPass, allUserGroups, loginType, onCreated }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [csvFile,        setCsvFile]        = useState(null);
  const [rawText,        setRawText]        = useState('');
  const [csvRows,        setCsvRows]        = useState([]);
  const [csvInvalid,     setCsvInvalid]     = useState([]);
  const [bulkResult,     setBulkResult]     = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [ignoreFirst,    setIgnoreFirst]    = useState(false);
  const [detailsOpen,    setDetailsOpen]    = useState(false);

  // Re-parse whenever raw text or options change
  useEffect(() => {
    if (!rawText) return;
    const { rows, invalid } = parseCSV(rawText, ignoreFirst, allUserGroups, loginType);
    setCsvRows(rows); setCsvInvalid(invalid);
  }, [rawText, ignoreFirst, allUserGroups, loginType]);

  const handleFile = e => {
    const file = e.target.files?.[0]; if (!file) return;
    setCsvFile(file); setBulkResult(null);
    const reader = new FileReader();
    reader.onload = ev => setRawText(ev.target.result);
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvRows.length) return;
    setLoading(true);
    try {
      const result = await api.bulkUsers(csvRows);
      setBulkResult(result); setCsvRows([]); setCsvFile(null); setCsvInvalid([]); setRawText('');
      if (fileRef.current) fileRef.current.value = '';
      onCreated();
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const codeStyle = { fontSize:12, color:'var(--text-secondary)', display:'block', background:'var(--surface)', padding:'6px 8px', borderRadius:4, border:'1px solid var(--border)', whiteSpace:'pre-wrap', overflowWrap:'anywhere', fontFamily:'monospace', marginBottom:4 };

  return (
    <div style={{ maxWidth:580, display:'flex', flexDirection:'column', gap:16 }}>

      {/* Format info box */}
      <div style={{ background:'var(--background)', border:'1px dashed var(--border)', borderRadius:'var(--radius)', padding:'12px 14px' }}>
        <p style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>CSV Format</p>
        <code style={codeStyle}>{'FULL:    email,firstname,lastname,dob,password,role,usergroup'}</code>
        <code style={codeStyle}>{'MINIMUM: email,firstname,lastname,,,,'}</code>
        <p style={{ fontSize:12, color:'var(--text-tertiary)', margin:'8px 0 6px' }}>Examples:</p>
        <code style={codeStyle}>{'example@rosterchirp.com,Barney,Rubble,1970-11-21,,member,parents'}</code>
        <code style={codeStyle}>{'example@rosterchirp.com,Barney,Rubble,2013-06-11,Ori0n2026!,member,players'}</code>
        <p style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:8 }}>
          Blank password defaults to <strong>{userPass}</strong>. Blank role defaults to member. We recommend using a spreadsheet editor and saving as CSV.
        </p>

        {/* CSV Details accordion */}
        <button onClick={() => setDetailsOpen(o => !o)}
          style={{ display:'flex', alignItems:'center', gap:6, marginTop:10, background:'none', border:'none', cursor:'pointer', fontSize:13, fontWeight:600, color:'var(--primary)', padding:0 }}>
          CSV Details
          <span style={{ fontSize:10, opacity:0.7 }}>{detailsOpen ? '▲' : '▼'}</span>
        </button>
        {detailsOpen && (
          <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text-secondary)', display:'flex', flexDirection:'column', gap:10 }}>
            <div>
              <p style={{ fontWeight:600, marginBottom:4 }}>CSV Requirements</p>
              <ul style={{ paddingLeft:16, margin:0, lineHeight:1.8 }}>
                <li>Exactly six (6) commas per row (rows with more or less will be skipped)</li>
                <li><code>email</code>, <code>firstname</code>, <code>lastname</code> are required fields{loginType === 'mixed_age' ? <> (DOB field required for <strong>Restricted</strong> login type)</> : ''}.</li>
                <li>A user can only be added to one group during bulk import</li>
                <li>Optional fields left blank will use system defaults</li>
              </ul>
            </div>
            {allUserGroups?.length > 0 && (
              <div>
                <p style={{ fontWeight:600, marginBottom:4 }}>User Groups available</p>
                <div style={{ display:'flex', flexDirection:'column', gap:1, paddingLeft:16 }}>
                  {allUserGroups.map(g => <span key={g.id} style={{ fontFamily:'monospace', fontSize:11 }}>{g.name}</span>)}
                </div>
              </div>
            )}
            <div>
              <p style={{ fontWeight:600, marginBottom:4 }}>Roles available</p>
              <ul style={{ paddingLeft:16, margin:0, lineHeight:1.8 }}>
                <li><code>member</code> — non-privileged user <span style={{ color:'var(--text-tertiary)' }}>(default)</span></li>
                <li><code>manager</code> — privileged: manage schedules/users/groups</li>
                <li><code>admin</code> — privileged: manager + settings + branding</li>
              </ul>
            </div>
            <p style={{ color:'var(--text-tertiary)', marginTop:2 }}>
              Optional field defaults: password = <strong>{userPass}</strong>, role = member, usergroup = (none)
            </p>
          </div>
        )}
      </div>

      {/* File picker row */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <label className="btn btn-secondary" style={{ cursor:'pointer', margin:0 }}>
          Select CSV File
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display:'none' }} onChange={handleFile} />
        </label>
        {csvFile && (
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>
            {csvFile.name}
            {csvRows.length > 0 && <span style={{ color:'var(--text-tertiary)', marginLeft:6 }}>({csvRows.length} valid row{csvRows.length!==1?'s':''})</span>}
          </span>
        )}
      </div>

      {/* Ignore first row checkbox */}
      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--text-primary)', userSelect:'none' }}>
        <input type="checkbox" checked={ignoreFirst} onChange={e => setIgnoreFirst(e.target.checked)}
          style={{ accentColor:'var(--primary)', width:15, height:15 }} />
        Ignore first row (header)
      </label>

      {/* Import button */}
      {csvRows.length > 0 && (
        <div>
          <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
            {loading ? 'Creating…' : `Create ${csvRows.length} User${csvRows.length!==1?'s':''}`}
          </button>
        </div>
      )}

      {/* Skipped rows */}
      {csvInvalid.length > 0 && (
        <div style={{ background:'rgba(229,57,53,0.07)', border:'1px solid #e53935', borderRadius:'var(--radius)', padding:10 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'#e53935', marginBottom:6 }}>{csvInvalid.length} row{csvInvalid.length!==1?'s':''} skipped</p>
          <div style={{ maxHeight:120, overflowY:'auto' }}>
            {csvInvalid.map((e,i) => (
              <div key={i} style={{ fontSize:12, padding:'2px 0', color:'var(--text-secondary)' }}>
                <code style={{ fontSize:11 }}>{e.line}</code>
                <span style={{ color:'#e53935', marginLeft:8 }}>— {e.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {bulkResult && (
        <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:12 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'var(--success)', marginBottom: bulkResult.skipped.length ? 8 : 0 }}>
            ✓ {bulkResult.created.length} user{bulkResult.created.length!==1?'s':''} created
          </p>
          {bulkResult.skipped.length > 0 && (
            <>
              <p style={{ fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:6 }}>{bulkResult.skipped.length} skipped:</p>
              <div style={{ maxHeight:112, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
                {bulkResult.skipped.map((s,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 10px', borderBottom: i<bulkResult.skipped.length-1?'1px solid var(--border)':'none', fontSize:13, gap:12 }}>
                    <span>{s.email}</span>
                    <span style={{ color:'var(--text-tertiary)', flexShrink:0 }}>{s.reason}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <button className="btn btn-secondary btn-sm" style={{ marginTop:10 }} onClick={() => setBulkResult(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function UserManagerPage({ isMobile = false, onProfile, onHelp, onAbout }) {
  const [users,        setUsers]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState('');
  const [search,       setSearch]       = useState('');
  const [view,         setView]         = useState('list'); // 'list' | 'create' | 'edit' | 'bulk'
  const [editUser,     setEditUser]     = useState(null);
  const [userPass,     setUserPass]     = useState('user@1234');
  const [allUserGroups, setAllUserGroups] = useState([]);
  const [loginType,    setLoginType]    = useState('all_ages');
  const [guardiansGroupUserIds, setGuardiansGroupUserIds] = useState(null); // null = not loaded yet
  const [inputFocused, setInputFocused] = useState(false);
  const onIF = () => setInputFocused(true);
  const onIB = () => setInputFocused(false);

  const load = useCallback(async () => {
    setLoadError(''); setLoading(true);
    try { const { users } = await api.getUsers(); setUsers(users || []); }
    catch(e) { setLoadError(e.message || 'Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    api.getSettings().then(({ settings }) => {
      if (settings.user_pass) setUserPass(settings.user_pass);
      setLoginType(settings.feature_login_type || 'all_ages');
      const guardiansGroupId = settings.feature_guardians_group_id ? parseInt(settings.feature_guardians_group_id) : null;
      if (guardiansGroupId) {
        api.getUserGroup(guardiansGroupId)
          .then(({ members }) => setGuardiansGroupUserIds(new Set((members || []).map(m => m.id))))
          .catch(() => setGuardiansGroupUserIds(null));
      }
    }).catch(() => {});
    api.getUserGroups().then(({ groups }) => setAllUserGroups([...(groups||[])].sort((a,b) => a.name.localeCompare(b.name)))).catch(() => {});
  }, [load]);

  const filtered = users
    .filter(u =>
      !search || u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const goList   = ()  => { setView('list');   setEditUser(null); };
  const goCreate = ()  => { setView('create'); setEditUser(null); };
  const goEdit   = (u) => { setView('edit');   setEditUser(u); };
  const goBulk   = ()  => { setView('bulk');   setEditUser(null); };

  const navItem = (label, active, onClick) => (
    <button onClick={onClick}
      style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px',
        borderRadius:'var(--radius)', border:'none',
        background: active ? 'var(--primary-light)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-primary)',
        cursor:'pointer', fontWeight: active ? 600 : 400, fontSize:14, marginBottom:2 }}>
      {label}
    </button>
  );

  const isFormView = view === 'create' || view === 'edit';

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <div style={{ width:SIDEBAR_W, flexShrink:0, borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', background:'var(--surface)', overflow:'hidden' }}>
          <div style={{ padding:'16px 16px 0' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>User Manager</span>
            </div>
            <div className="section-label" style={{ marginBottom:6 }}>View</div>
            {navItem(`All Users${!loading ? ` (${users.length})` : ''}`, view === 'list' || view === 'edit', goList)}
            {navItem('+ Create User', view === 'create', goCreate)}
            {navItem('Bulk Import CSV', view === 'bulk', goBulk)}
          </div>
          <div style={{ flex:1 }} />
          <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
        </div>
      )}

      {/* ── Right panel ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0, background:'var(--background)' }}>

        {/* Mobile tab bar */}
        {isMobile && (
          <div style={{ background:'var(--surface)', borderBottom:'1px solid var(--border)', padding:'0 12px', display:'flex', gap:6, height:48, alignItems:'center', flexShrink:0 }}>
            <span style={{ fontWeight:700, fontSize:14, marginRight:4, color:'var(--text-primary)' }}>Users</span>
            <button className={`btn btn-sm ${!isFormView && view !== 'bulk' ? 'btn-primary' : 'btn-secondary'}`} onClick={goList}>All</button>
            <button className={`btn btn-sm ${isFormView ? 'btn-primary' : 'btn-secondary'}`} onClick={goCreate}>+ Create</button>
            <button className={`btn btn-sm ${view === 'bulk' ? 'btn-primary' : 'btn-secondary'}`} onClick={goBulk}>Bulk</button>
          </div>
        )}

        {/* Content */}
        {/* form wrapper suppresses Chrome Android's autofill chip bar; autoComplete="new-password"
            on individual inputs is ignored by Chrome but respected on the form element */}
        <form autoComplete="new-password" onSubmit={e => e.preventDefault()} style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0, background:'var(--background)' }}>

          {/* LIST VIEW */}
          {view === 'list' && (
            <>
              <div style={{ padding:'16px 16px 8px', flexShrink:0 }}>
                <input className="input" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)}
                  onFocus={onIF} onBlur={onIB}
                    autoComplete="new-password" autoCorrect="off" spellCheck={false}
                  style={{ width:'100%', maxWidth: isMobile ? '100%' : 400 }} />
              </div>
              <div style={{ flex:1, overflowY:'auto', padding:'0 16px', paddingBottom: isMobile ? 'calc(82px + env(safe-area-inset-bottom, 0px))' : 16, overscrollBehavior:'contain' }}>
                <div style={{ background:'var(--surface)', borderRadius:'var(--radius)', boxShadow:'var(--shadow-sm)', overflow:'hidden' }}>
                  {loading ? (
                    <div style={{ padding:48, textAlign:'center' }}><div className="spinner" /></div>
                  ) : loadError ? (
                    <div style={{ padding:32, textAlign:'center', color:'var(--error)' }}>
                      <div style={{ marginBottom:12 }}>⚠ {loadError}</div>
                      <button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div style={{ padding:32, textAlign:'center', color:'var(--text-tertiary)', fontSize:14 }}>
                      {search ? 'No users match your search.' : 'No users yet.'}
                    </div>
                  ) : (
                    filtered.map(u => <UserRow key={u.id} u={u} onUpdated={load} onEdit={goEdit} />)
                  )}
                </div>
              </div>
            </>
          )}

          {/* CREATE / EDIT FORM */}
          {isFormView && (
            <div style={{ flex:1, overflowY:'auto', padding:16, paddingBottom: isMobile ? 'calc(82px + env(safe-area-inset-bottom, 0px))' : 16, overscrollBehavior:'contain' }}>
              <UserForm
                key={view === 'edit' ? editUser?.id : 'new'}
                user={view === 'edit' ? editUser : null}
                userPass={userPass}
                allUserGroups={allUserGroups}
                nonMinorUsers={users.filter(u => !u.is_minor && u.status === 'active' && (guardiansGroupUserIds === null || guardiansGroupUserIds.has(u.id)))}
                loginType={loginType}
                onDone={() => { load(); goList(); }}
                onCancel={goList}
                isMobile={isMobile}
                onIF={onIF}
                onIB={onIB}
              />
            </div>
          )}

          {/* BULK IMPORT */}
          {view === 'bulk' && (
            <div style={{ flex:1, overflowY:'auto', padding:16, paddingBottom: isMobile ? 'calc(82px + env(safe-area-inset-bottom, 0px))' : 16, overscrollBehavior:'contain' }}>
              <BulkImportForm userPass={userPass} allUserGroups={allUserGroups} loginType={loginType} onCreated={load} />
            </div>
          )}
        </div>
        </form>

        {/* Mobile footer — fixed, hidden when keyboard is up */}
        {isMobile && !inputFocused && (
          <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:20, background:'var(--surface)', borderTop:'1px solid var(--border)' }}>
            <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
          </div>
        )}
      </div>
    </div>
  );
}
