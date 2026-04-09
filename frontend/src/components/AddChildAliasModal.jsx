import { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../utils/api.js';

export default function AddChildAliasModal({ features = {}, onClose }) {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const loginType = features.loginType || 'guardian_only';
  const isMixedAge = loginType === 'mixed_age';

  // ── Guardian-only state (alias form) ──────────────────────────────────────
  const [aliases, setAliases]             = useState([]);
  const [editingAlias, setEditingAlias]   = useState(null);
  const [form, setForm]                   = useState({ firstName: '', lastName: '', dob: '', phone: '', email: '' });
  const [avatarFile, setAvatarFile]       = useState(null);
  const [saving, setSaving]               = useState(false);

  // ── Mixed-age state (real minor users) ────────────────────────────────────
  const [minorPlayers, setMinorPlayers]   = useState([]); // available + already-mine
  const [selectedMinorId, setSelectedMinorId] = useState('');
  const [childDob, setChildDob]           = useState('');
  const [addingMinor, setAddingMinor]     = useState(false);

  // ── Partner state (shared) ────────────────────────────────────────────────
  const [partner, setPartner]             = useState(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [respondSeparately, setRespondSeparately] = useState(false);
  const [allUsers, setAllUsers]           = useState([]);
  const [savingPartner, setSavingPartner] = useState(false);

  useEffect(() => {
    const loads = [api.getPartner(), api.searchUsers('')];
    if (isMixedAge) {
      loads.push(api.getMinorPlayers());
    } else {
      loads.push(api.getAliases());
    }
    Promise.all(loads).then(([partnerRes, usersRes, thirdRes]) => {
      const p = partnerRes.partner || null;
      setPartner(p);
      setSelectedPartnerId(p?.id?.toString() || '');
      setRespondSeparately(p?.respond_separately || false);
      setAllUsers((usersRes.users || []).filter(u => u.id !== currentUser?.id && !u.is_default_admin));
      if (isMixedAge) {
        setMinorPlayers(thirdRes.users || []);
      } else {
        setAliases(thirdRes.aliases || []);
      }
    }).catch(() => {});
  }, [isMixedAge]);

  // Pre-populate DOB when a minor is selected from the dropdown
  useEffect(() => {
    if (!selectedMinorId) { setChildDob(''); return; }
    const minor = availableMinors.find(u => u.id === parseInt(selectedMinorId));
    setChildDob(minor?.date_of_birth ? minor.date_of_birth.slice(0, 10) : '');
  }, [selectedMinorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const resetForm = () => {
    setEditingAlias(null);
    setForm({ firstName: '', lastName: '', dob: '', phone: '', email: '' });
    setAvatarFile(null);
  };

  const lbl = (text, required) => (
    <label className="text-sm" style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
      {text}{required && <span style={{ color: 'var(--error)', marginLeft: 2 }}>*</span>}
    </label>
  );

  // ── Partner handlers ──────────────────────────────────────────────────────
  const handleSavePartner = async () => {
    setSavingPartner(true);
    try {
      if (!selectedPartnerId) {
        await api.removePartner();
        setPartner(null);
        setRespondSeparately(false);
        if (!isMixedAge) {
          const { aliases: fresh } = await api.getAliases();
          setAliases(fresh || []);
          resetForm();
        } else {
          const { users: fresh } = await api.getMinorPlayers();
          setMinorPlayers(fresh || []);
        }
        toast('Spouse/Partner/Co-Parent removed', 'success');
      } else {
        const { partner: p } = await api.setPartner(parseInt(selectedPartnerId), respondSeparately);
        setPartner(p);
        setRespondSeparately(p?.respond_separately || false);
        if (!isMixedAge) {
          const { aliases: fresh } = await api.getAliases();
          setAliases(fresh || []);
        }
        toast('Spouse/Partner/Co-Parent saved', 'success');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingPartner(false);
    }
  };

  // ── Guardian-only alias handlers ──────────────────────────────────────────
  const handleSelectAlias = (a) => {
    if (editingAlias?.id === a.id) { resetForm(); return; }
    setEditingAlias(a);
    setForm({
      firstName: a.first_name || '',
      lastName:  a.last_name  || '',
      dob:       a.date_of_birth ? a.date_of_birth.slice(0, 10) : '',
      phone:     a.phone || '',
      email:     a.email || '',
    });
    setAvatarFile(null);
  };

  const handleSaveAlias = async () => {
    if (!form.firstName.trim() || !form.lastName.trim())
      return toast('First and last name required', 'error');
    setSaving(true);
    try {
      if (editingAlias) {
        await api.updateAlias(editingAlias.id, {
          firstName:   form.firstName.trim(),
          lastName:    form.lastName.trim(),
          dateOfBirth: form.dob   || null,
          phone:       form.phone || null,
          email:       form.email || null,
        });
        if (avatarFile) await api.uploadAliasAvatar(editingAlias.id, avatarFile);
        toast('Child alias updated', 'success');
      } else {
        const { alias } = await api.createAlias({
          firstName:   form.firstName.trim(),
          lastName:    form.lastName.trim(),
          dateOfBirth: form.dob   || null,
          phone:       form.phone || null,
          email:       form.email || null,
        });
        if (avatarFile) await api.uploadAliasAvatar(alias.id, avatarFile);
        toast('Child alias added', 'success');
      }
      const { aliases: fresh } = await api.getAliases();
      setAliases(fresh || []);
      resetForm();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAlias = async (e, aliasId) => {
    e.stopPropagation();
    try {
      await api.deleteAlias(aliasId);
      setAliases(prev => prev.filter(a => a.id !== aliasId));
      if (editingAlias?.id === aliasId) resetForm();
      toast('Child alias removed', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  // ── Mixed-age minor handlers ──────────────────────────────────────────────
  const myMinors = minorPlayers.filter(u => u.guardian_user_id === currentUser?.id);
  const availableMinors = minorPlayers.filter(u => !u.guardian_user_id);

  const handleAddMinor = async () => {
    if (!selectedMinorId) return;
    if (!childDob.trim()) return toast('Date of Birth is required', 'error');
    setAddingMinor(true);
    try {
      await api.addGuardianChild(parseInt(selectedMinorId), childDob.trim());
      const { users: fresh } = await api.getMinorPlayers();
      setMinorPlayers(fresh || []);
      setSelectedMinorId('');
      setChildDob('');
      toast('Child added and account activated', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAddingMinor(false);
    }
  };

  const handleRemoveMinor = async (e, minorId) => {
    e.stopPropagation();
    try {
      await api.removeGuardianChild(minorId);
      const { users: fresh } = await api.getMinorPlayers();
      setMinorPlayers(fresh || []);
      toast('Child removed', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Family Manager</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Spouse/Partner/Co-Parent section */}
        <div style={{ marginBottom: 16 }}>
          {lbl('Spouse/Partner/Co-Parent')}
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="input"
              style={{ flex: 1 }}
              value={selectedPartnerId}
              onChange={e => setSelectedPartnerId(e.target.value)}
            >
              <option value="">— None —</option>
              {allUsers.map(u => (
                <option key={u.id} value={u.id}>{u.display_name || u.name}</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              onClick={handleSavePartner}
              disabled={savingPartner}
              style={{ whiteSpace: 'nowrap' }}
            >
              {savingPartner ? 'Saving…' : 'Save'}
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={respondSeparately}
              onChange={e => setRespondSeparately(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--primary)' }}
            />
            Respond separately to events
          </label>
          {partner && (
            <div className="text-sm" style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
              Linked with {partner.display_name || partner.name}
            </div>
          )}
        </div>

        {/* ── Mixed Age: link real minor users ── */}
        {isMixedAge && (
          <>
            {/* Current children list */}
            {myMinors.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Your Children
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  {myMinors.map((u, i) => (
                    <div
                      key={u.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px',
                        borderBottom: i < myMinors.length - 1 ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      <span style={{ flex: 1, fontSize: 14 }}>{u.first_name} {u.last_name}</span>
                      {u.date_of_birth && (
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {u.date_of_birth.slice(0, 10)}
                        </span>
                      )}
                      <button
                        onClick={e => handleRemoveMinor(e, u.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
                        aria-label="Remove"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add minor from players group */}
            <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
              Add Child
            </div>
            <select
              className="input"
              style={{ marginBottom: 8 }}
              value={selectedMinorId}
              onChange={e => setSelectedMinorId(e.target.value)}
            >
              <option value="">— Select a player —</option>
              {availableMinors.map(u => (
                <option key={u.id} value={u.id}>
                  {u.first_name} {u.last_name}
                </option>
              ))}
            </select>
            <div style={{ marginBottom: 8 }}>
              {lbl('Date of Birth', true)}
              <input
                className="input"
                type="text"
                placeholder="YYYY-MM-DD"
                value={childDob}
                onChange={e => setChildDob(e.target.value)}
                autoComplete="off"
                style={childDob === '' && selectedMinorId ? { borderColor: 'var(--error)' } : {}}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                onClick={handleAddMinor}
                disabled={addingMinor || !selectedMinorId || !childDob.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {addingMinor ? 'Adding…' : 'Add'}
              </button>
            </div>
            {availableMinors.length === 0 && myMinors.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)', marginTop: 8 }}>
                No minor players available to link.
              </p>
            )}
          </>
        )}

        {/* ── Guardian Only: alias form ── */}
        {!isMixedAge && (
          <>
            {/* Existing aliases list */}
            {aliases.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Your Children — click to edit
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  {aliases.map((a, i) => (
                    <div
                      key={a.id}
                      onClick={() => handleSelectAlias(a)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', cursor: 'pointer',
                        borderBottom: i < aliases.length - 1 ? '1px solid var(--border)' : 'none',
                        background: editingAlias?.id === a.id ? 'var(--primary-light)' : 'transparent',
                      }}
                    >
                      <span style={{ flex: 1, fontSize: 14, fontWeight: editingAlias?.id === a.id ? 600 : 400 }}>
                        {a.first_name} {a.last_name}
                      </span>
                      {a.date_of_birth && (
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {a.date_of_birth.slice(0, 10)}
                        </span>
                      )}
                      <button
                        onClick={e => handleDeleteAlias(e, a.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
                        aria-label="Remove"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Form section label */}
            <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>
              {editingAlias
                ? `Editing: ${editingAlias.first_name} ${editingAlias.last_name}`
                : 'Add Child'}
            </div>

            {/* Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  {lbl('First Name', true)}
                  <input className="input" value={form.firstName} onChange={set('firstName')}
                    autoComplete="off" autoCapitalize="words" />
                </div>
                <div>
                  {lbl('Last Name', true)}
                  <input className="input" value={form.lastName} onChange={set('lastName')}
                    autoComplete="off" autoCapitalize="words" />
                </div>
                <div>
                  {lbl('Date of Birth')}
                  <input className="input" placeholder="YYYY-MM-DD" value={form.dob} onChange={set('dob')}
                    autoComplete="off" />
                </div>
                <div>
                  {lbl('Phone')}
                  <input className="input" type="tel" value={form.phone} onChange={set('phone')}
                    autoComplete="off" />
                </div>
              </div>
              <div>
                {lbl('Email (optional)')}
                <input className="input" type="email" value={form.email} onChange={set('email')}
                  autoComplete="off" />
              </div>
              <div>
                {lbl('Avatar (optional)')}
                <input type="file" accept="image/*"
                  onChange={e => setAvatarFile(e.target.files?.[0] || null)} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                {editingAlias && (
                  <button className="btn btn-secondary" onClick={resetForm}>Cancel Edit</button>
                )}
                <button className="btn btn-primary" onClick={handleSaveAlias} disabled={saving}>
                  {saving ? 'Saving…' : editingAlias ? 'Update Alias' : 'Add Alias'}
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
