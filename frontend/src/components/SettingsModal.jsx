import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

const APP_TYPES = {
  'RosterChirp-Chat':  { label: 'RosterChirp-Chat',  desc: 'Chat only. No Branding, Group Manager or Schedule Manager.' },
  'RosterChirp-Brand': { label: 'RosterChirp-Brand', desc: 'Chat and Branding.' },
  'RosterChirp-Team':  { label: 'RosterChirp-Team',  desc: 'Chat, Branding, Group Manager and Schedule Manager.' },
};

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        width: 44, height: 24, borderRadius: 12, cursor: 'pointer', flexShrink: 0,
        background: checked ? 'var(--primary)' : 'var(--border)',
        position: 'relative', transition: 'background 0.2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: '50%',
        background: 'white', transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

// ── Messages Tab ──────────────────────────────────────────────────────────────
function MessagesTab() {
  const toast = useToast();
  const [settings, setSettings] = useState({
    msgPublic: true,
    msgGroup: true,
    msgPrivateGroup: true,
    msgU2U: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(({ settings: s }) => {
      setSettings({
        msgPublic:       s.feature_msg_public        !== 'false',
        msgGroup:        s.feature_msg_group         !== 'false',
        msgPrivateGroup: s.feature_msg_private_group !== 'false',
        msgU2U:          s.feature_msg_u2u           !== 'false',
      });
    }).catch(() => {});
  }, []);

  const toggle = (key) => setSettings(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateMessageSettings(settings);
      toast('Message settings saved', 'success');
      window.dispatchEvent(new Event('rosterchirp:settings-changed'));
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const rows = [
    { key: 'msgPublic',       label: 'Public Messages',         desc: 'Public group channels visible to all members.' },
    { key: 'msgGroup',        label: 'User Group Messages',     desc: 'Private group messages managed by User Groups.' },
    { key: 'msgPrivateGroup', label: 'Private Group Messages',  desc: 'Private multi-member group conversations.' },
    { key: 'msgU2U',          label: 'Private Messages (U2U)',  desc: 'One-on-one direct messages between users.' },
  ];

  return (
    <div>
      <div className="settings-section-label">Message Features</div>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        Disable a feature to hide it from all menus, sidebars, and modals.
      </p>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 16 }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{r.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{r.desc}</div>
            </div>
            <Toggle checked={settings[r.key]} onChange={() => toggle(r.key)} />
          </div>
        ))}
      </div>
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// ── Team Management Tab ───────────────────────────────────────────────────────
function TeamManagementTab() {
  const toast = useToast();
  const [userGroups, setUserGroups] = useState([]);
  const [toolManagers, setToolManagers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getUserGroups().then(({ groups }) => setUserGroups([...(groups||[])].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    api.getSettings().then(({ settings }) => {
      // Read from unified key, fall back to legacy key
      setToolManagers(JSON.parse(settings.team_tool_managers || settings.team_group_managers || '[]'));
    }).catch(() => {});
  }, []);

  const toggle = (id) => {
    setToolManagers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateTeamSettings({ toolManagers });
      toast('Team settings saved', 'success');
      window.dispatchEvent(new Event('rosterchirp:settings-changed'));
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="settings-section-label">Tool Managers</div>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
        Members of selected groups can access Group Manager, Schedule Manager, and User Manager. Admin users always have access to all three tools.
      </p>
      {userGroups.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>No user groups created yet. Create groups in the Group Manager first.</p>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 16 }}>
          {userGroups.map(g => (
            <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
              <input type="checkbox" checked={toolManagers.includes(g.id)} onChange={() => toggle(g.id)}
                style={{ accentColor: 'var(--primary)', width: 15, height: 15 }} />
              <div style={{ width: 24, height: 24, borderRadius: 5, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>UG</div>
              <span style={{ flex: 1, fontSize: 14 }}>{g.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{g.member_count} member{g.member_count !== 1 ? 's' : ''}</span>
            </label>
          ))}
        </div>
      )}
      {toolManagers.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>No groups selected — tools are admin-only.</p>
      )}
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// ── Login Type Tab ────────────────────────────────────────────────────────────
const LOGIN_TYPE_OPTIONS = [
  {
    id: 'all_ages',
    label: 'Unrestricted (default)',
    desc: 'No age restrictions. All users interact normally.',
  },
  {
    id: 'guardian_only',
    label: 'Guardian Only',
    desc: "Parents/Guardians login one. Parents/Guardians are required to add their child's details in the \"Family Manager\". They will also respond on behalf of the child for events with availability tracking.",
  },
  {
    id: 'mixed_age',
    label: 'Restricted',
    desc: "No age restriction for login. Date of Birth is a required field. Parents/Guardians must select their child in the Family Manager to allow them to login. Any private message initiated by any adult to a minor aged user will include the child's designated guardian.",
  },
];

function LoginTypeTab() {
  const toast = useToast();
  const [loginType,       setLoginType]       = useState('all_ages');
  const [playersGroupId,  setPlayersGroupId]   = useState('');
  const [guardiansGroupId,setGuardiansGroupId] = useState('');
  const [userGroups,      setUserGroups]       = useState([]);
  const [canChange,       setCanChange]        = useState(false);
  const [saving,          setSaving]           = useState(false);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getUserGroups()]).then(([{ settings: s }, { groups }]) => {
      setLoginType(s.feature_login_type || 'all_ages');
      setPlayersGroupId(s.feature_players_group_id || '');
      setGuardiansGroupId(s.feature_guardians_group_id || '');
      setUserGroups([...(groups || [])].sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});
    // Determine if the user table is empty enough to allow changes
    api.getUsers().then(({ users }) => {
      const nonAdmins = (users || []).filter(u => u.role !== 'admin');
      setCanChange(nonAdmins.length === 0);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateLoginType({
        loginType,
        playersGroupId:   playersGroupId  ? parseInt(playersGroupId)  : null,
        guardiansGroupId: guardiansGroupId ? parseInt(guardiansGroupId) : null,
      });
      toast('Login Type settings saved', 'success');
      window.dispatchEvent(new Event('rosterchirp:settings-changed'));
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const needsGroups = loginType !== 'all_ages';

  return (
    <div>
      <div className="settings-section-label">Login Type</div>

      {/* Warning */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--surface-variant)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>⚠️</span>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          This setting can only be set or changed when the user table is empty (no non-admin users exist).
        </p>
      </div>

      {/* Options */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 16 }}>
        {LOGIN_TYPE_OPTIONS.map((opt, i) => (
          <label key={opt.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderBottom: i < LOGIN_TYPE_OPTIONS.length - 1 ? '1px solid var(--border)' : 'none', cursor: canChange ? 'pointer' : 'not-allowed', opacity: canChange ? 1 : 0.6 }}>
            <input type="radio" name="loginType" value={opt.id} checked={loginType === opt.id} disabled={!canChange}
              onChange={() => setLoginType(opt.id)} style={{ marginTop: 3, accentColor: 'var(--primary)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{opt.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.5 }}>{opt.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Group selectors — only shown for Guardian Only / Mixed Age */}
      {needsGroups && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <div>
            <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Players Group</label>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6 }}>Select a group that minor aged users will be put in by default. *</p>
            <select className="input" value={playersGroupId} disabled={!canChange}
              onChange={e => setPlayersGroupId(e.target.value)}>
              <option value="">— Select group —</option>
              {userGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Guardians Group</label>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6 }}>Members of the selected group will have access to Family Manager. *</p>
            <select className="input" value={guardiansGroupId} disabled={!canChange}
              onChange={e => setGuardiansGroupId(e.target.value)}>
              <option value="">— Select group —</option>
              {userGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
            * Open Group Manager to create a different group, if none are suitable in these lists.
          </p>
        </div>
      )}

      <button className="btn btn-primary" onClick={handleSave} disabled={saving || !canChange}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// ── Registration Tab ──────────────────────────────────────────────────────────
function RegistrationTab({ onFeaturesChanged }) {
  const toast = useToast();
  const [settings, setSettings] = useState({});
  const [regCode, setRegCode] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getSettings().then(({ settings }) => setSettings(settings)).catch(() => {});
  }, []);

  const appType = settings.app_type || 'RosterChirp-Chat';
  const activeCode = settings.registration_code || '';
  const adminEmail = settings.admin_email || '—';

  // Placeholder serial number derived from hostname
  const serialNumber = btoa(window.location.hostname).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16).padEnd(16, '0');

  const handleCopySerial = async () => {
    await navigator.clipboard.writeText(serialNumber).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegister = async () => {
    if (!regCode.trim()) return toast('Enter a registration code', 'error');
    setRegLoading(true);
    try {
      const { features: f } = await api.registerCode(regCode.trim());
      setRegCode('');
      const fresh = await api.getSettings();
      setSettings(fresh.settings);
      toast('Registration applied successfully.', 'success');
      window.dispatchEvent(new Event('rosterchirp:settings-changed'));
      onFeaturesChanged && onFeaturesChanged(f);
    } catch (e) { toast(e.message || 'Invalid registration code', 'error'); }
    finally { setRegLoading(false); }
  };

  const handleClear = async () => {
    try {
      const { features: f } = await api.registerCode('');
      const fresh = await api.getSettings();
      setSettings(fresh.settings);
      toast('Registration cleared.', 'success');
      window.dispatchEvent(new Event('rosterchirp:settings-changed'));
      onFeaturesChanged && onFeaturesChanged(f);
    } catch (e) { toast(e.message, 'error'); }
  };

  const typeInfo = APP_TYPES[appType] || APP_TYPES['RosterChirp-Chat'];
  const siteUrl = window.location.origin;

  return (
    <div>
      {/* Info box */}
      <div style={{ background: 'var(--surface-variant)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Registration {activeCode ? 'is' : 'required:'}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          RosterChirp {activeCode ? 'is' : 'will be'} registered to:<br />
          <strong>Type:</strong> {typeInfo.label}<br />
          <strong>URL:</strong> {siteUrl}
        </p>
      </div>

      {/* Type */}
      <div style={{ marginBottom: 16 }}>
        <div className="settings-section-label">Application Type</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <div style={{ padding: '7px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface-variant)', fontSize: 14, fontWeight: 600, color: 'var(--primary)' }}>
            {typeInfo.label}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{typeInfo.desc}</span>
        </div>
      </div>

      {/* Serial Number */}
      <div style={{ marginBottom: 16 }}>
        <div className="settings-section-label">Serial Number</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <input className="input flex-1" value={serialNumber} readOnly style={{ fontFamily: 'monospace', letterSpacing: 1 }} autoComplete="off" />
          <button className="btn btn-secondary btn-sm" onClick={handleCopySerial} style={{ flexShrink: 0 }}>
            {copied ? '✓ Copied' : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Registration Code */}
      <div style={{ marginBottom: 20 }}>
        <div className="settings-section-label">Registration Code</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input className="input flex-1" placeholder="Enter registration code" value={regCode}
            onChange={e => setRegCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRegister()} autoComplete="off" />
          <button className="btn btn-primary btn-sm" onClick={handleRegister} disabled={regLoading}>
            {regLoading ? '…' : 'Register'}
          </button>
        </div>
      </div>

      {activeCode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Registered — {typeInfo.label}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={handleClear}>Clear</button>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 16, lineHeight: 1.5 }}>
        Registration codes unlock application features. Contact your RosterChirp provider for a code.
      </p>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function SettingsModal({ onClose, onFeaturesChanged }) {
  const [tab, setTab] = useState('login-type');
  const [appType, setAppType] = useState('RosterChirp-Chat');

  useEffect(() => {
    api.getSettings().then(({ settings }) => {
      setAppType(settings.app_type || 'RosterChirp-Chat');
    }).catch(() => {});
    const handler = () => api.getSettings().then(({ settings }) => setAppType(settings.app_type || 'RosterChirp-Chat')).catch(() => {});
    window.addEventListener('rosterchirp:settings-changed', handler);
    return () => window.removeEventListener('rosterchirp:settings-changed', handler);
  }, []);

  const isTeam = appType === 'RosterChirp-Team';

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Settings</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Select navigation */}
        <div style={{ marginBottom: 24 }}>
          <label className="text-sm" style={{ color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>SELECT OPTION:</label>
          <select className="input" value={tab} onChange={e => setTab(e.target.value)}>
            <option value="login-type">Login Type</option>
            <option value="messages">Messages</option>
            {isTeam && <option value="team">Tools</option>}
            <option value="registration">Registration</option>
          </select>
        </div>

        {tab === 'messages'     && <MessagesTab />}
        {tab === 'team'         && <TeamManagementTab />}
        {tab === 'login-type'   && <LoginTypeTab />}
        {tab === 'registration' && <RegistrationTab onFeaturesChanged={onFeaturesChanged} />}
      </div>
    </div>
  );
}
