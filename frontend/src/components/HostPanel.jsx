/**
 * HostPanel.jsx — RosterChirp-Host Control Panel
 *
 * Renders inside the main RosterChirp right-panel area (not a separate page/route).
 * Protected by:
 *   1. Only shown when is_host_domain === true (server-computed from HOST_DOMAIN)
 *   2. Only accessible to admin role users
 *   3. HOST_ADMIN_KEY prompt on first access per session
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import UserFooter from './UserFooter.jsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const PLANS = [
  { value: 'chat',  label: 'RosterChirp-Chat',  desc: 'Chat only' },
  { value: 'brand', label: 'RosterChirp-Brand', desc: 'Chat + Branding' },
  { value: 'team',  label: 'RosterChirp-Team',  desc: 'Chat + Branding + Groups + Schedule' },
];

const PLAN_COLOURS = {
  chat:  { bg: 'var(--primary-light)', color: 'var(--primary)' },
  brand: { bg: '#fef3c7',              color: '#b45309' },
  team:  { bg: '#dcfce7',              color: '#15803d' },
};

const STATUS_COLOURS = {
  active:    { bg: '#dcfce7', color: '#15803d' },
  suspended: { bg: '#fef3c7', color: '#b45309' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ value, map }) {
  const s = map[value] || { bg: 'var(--background)', color: 'var(--text-secondary)' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
      {value}
    </span>
  );
}

function FieldGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</label>}
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', hint, required }) {
  return (
    <FieldGroup label={label}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} autoComplete="new-password" placeholder={placeholder} required={required}
        autoComplete="new-password" autoCorrect="off" spellCheck={false}
        className="input" style={{ fontSize: 13 }} />
      {hint && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{hint}</span>}
    </FieldGroup>
  );
}

function FieldSelect({ label, value, onChange, options }) {
  return (
    <FieldGroup label={label}>
      <select value={value} onChange={e => onChange(e.target.value)} className="input" style={{ fontSize: 13 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}{o.desc ? ` — ${o.desc}` : ''}</option>)}
      </select>
    </FieldGroup>
  );
}

// ── API calls using the stored host admin key ─────────────────────────────────

function useHostApi(adminKey) {
  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`/api/host${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Host-Admin-Key': adminKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [adminKey]);

  return {
    getStatus:     ()         => call('GET',    '/status'),
    getTenants:    ()         => call('GET',    '/tenants'),
    createTenant:  (b)        => call('POST',   '/tenants', b),
    updateTenant:  (slug, b)  => call('PATCH',  `/tenants/${slug}`, b),
    deleteTenant:  (slug)     => call('DELETE', `/tenants/${slug}`, { confirm: `DELETE ${slug}` }),
    suspendTenant: (slug)     => call('PATCH',  `/tenants/${slug}`, { status: 'suspended' }),
    activateTenant:(slug)     => call('PATCH',  `/tenants/${slug}`, { status: 'active' }),
    migrateAll:    ()         => call('POST',   '/migrate-all'),
  };
}

// ── Provision modal ───────────────────────────────────────────────────────────

function ProvisionModal({ api, baseDomain, onClose, onDone, toast }) {
  const [form, setForm] = useState({ slug:'', name:'', plan:'chat', adminEmail:'', adminName:'Admin User', adminPass:'', customDomain:'' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = k => v => setForm(f => ({ ...f, [k]: v }));
  const preview = form.slug ? `${form.slug.toLowerCase()}.${baseDomain}` : '';

  const handle = async () => {
    if (!form.slug || !form.name) return setError('Slug and name are required');
    setSaving(true); setError('');
    try {
      const { tenant } = await api.createTenant({
        slug: form.slug.toLowerCase().trim(), name: form.name.trim(), plan: form.plan,
        adminEmail: form.adminEmail || undefined, adminName: form.adminName || undefined,
        adminPass: form.adminPass || undefined, customDomain: form.customDomain || undefined,
      });
      onDone(tenant);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Provision New Tenant</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {error && <div style={{ padding:'10px 14px', background:'#fce8e6', color:'var(--error)', borderRadius:6, fontSize:13, marginBottom:16 }}>{error}</div>}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <Field label="Slug *" value={form.slug} onChange={set('slug')} placeholder="team-alpha"
              hint={preview ? `→ ${preview}` : 'Subdomain + schema name'} />
            <Field label="Display Name *" value={form.name} onChange={set('name')} placeholder="Team Alpha" />
          </div>
          <FieldSelect label="Plan" value={form.plan} onChange={set('plan')} options={PLANS} />
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:10 }}>First Admin (optional)</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="admin@teamalpha.com" type="email" />
              <Field label="Name" value={form.adminName} onChange={set('adminName')} placeholder="Admin User" />
              <Field label="Temp Password" value={form.adminPass} onChange={set('adminPass')} placeholder="Blank = .env default" />
            </div>
          </div>
          <Field label="Custom Domain (optional)" value={form.customDomain} onChange={set('customDomain')} placeholder="chat.teamalpha.com" />
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, paddingTop:4 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handle} disabled={saving}>
              {saving ? 'Provisioning…' : '+ New Tenant'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({ api, tenant, onClose, onDone }) {
  const [form, setForm] = useState({ name: tenant.name, plan: tenant.plan, customDomain: tenant.custom_domain || '' });
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = k => v => setForm(f => ({ ...f, [k]: v }));

  const handle = async () => {
    if (adminPassword && adminPassword.length < 6)
      return setError('Admin password must be at least 6 characters');
    setSaving(true); setError('');
    try {
      const { tenant: updated } = await api.updateTenant(tenant.slug, {
        name: form.name || undefined, plan: form.plan, customDomain: form.customDomain || null,
        ...(adminPassword ? { adminPassword } : {}),
      });
      onDone(updated);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const adminEmail = tenant.admin_email || '(uses system default from .env)';

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Edit — {tenant.slug}</h2>
          <button className="btn-icon" onClick={onClose}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        {error && <div style={{ padding:'10px 14px', background:'#fce8e6', color:'var(--error)', borderRadius:6, fontSize:13, marginBottom:14 }}>{error}</div>}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Field label="Display Name" value={form.name} onChange={set('name')} />
          <FieldSelect label="Plan" value={form.plan} onChange={set('plan')} options={PLANS} />
          <Field label="Custom Domain" value={form.customDomain} onChange={set('customDomain')} placeholder="chat.example.com" hint="Leave blank to remove" />
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:10 }}>Admin Account</div>
            <FieldGroup label="Login Email (read-only)">
              <input type="text" value={adminEmail} readOnly
                className="input" style={{ fontSize:13, opacity:0.7, cursor:'default' }} />
            </FieldGroup>
            <div style={{ marginTop:10 }}>
              <FieldGroup label="Reset Admin Password" >
                <div style={{ position:'relative' }}>
                  <input
                    type={showAdminPass ? 'text' : 'password'}
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    placeholder="Leave blank to keep current password"
                    autoComplete="new-password"
                    className="input"
                    style={{ fontSize:13, paddingRight:40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPass(v => !v)}
                    style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-tertiary)', padding:0, display:'flex', alignItems:'center' }}
                    tabIndex={-1}
                  >
                    {showAdminPass ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
                <span style={{ fontSize:11, color:'var(--text-tertiary)' }}>Admin will be required to change password on next login</span>
              </FieldGroup>
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handle} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteModal({ api, tenant, onClose, onDone }) {
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState('');
  const expected = `DELETE ${tenant.slug}`;

  const handle = async () => {
    setDeleting(true); setError('');
    try { await api.deleteTenant(tenant.slug); onDone(tenant.slug); }
    catch (e) { setError(e.message); setDeleting(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Delete Tenant</h2>
          <button className="btn-icon" onClick={onClose}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div style={{ padding:'12px 16px', background:'#fce8e6', borderRadius:8, fontSize:13, color:'var(--error)', marginBottom:16 }}>
          <strong>Permanent.</strong> Drops the Postgres schema and all tenant data — users, messages, events, uploads.
        </div>
        <p style={{ fontSize:13, color:'var(--text-primary)', marginBottom:12 }}>
          Type <code style={{ background:'var(--background)', padding:'2px 6px', borderRadius:4 }}>{expected}</code> to confirm:
        </p>
        {error && <div style={{ color:'var(--error)', fontSize:13, marginBottom:10 }}>{error}</div>}
        <input className="input" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" placeholder={expected} style={{ marginBottom:16 }} autoComplete="new-password" />
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={handle} disabled={confirm !== expected || deleting}>
            {deleting ? 'Deleting…' : 'Permanently Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tenant row ────────────────────────────────────────────────────────────────

function TenantRow({ tenant, baseDomain, api, onRefresh, onToast }) {
  const [editing,  setEditing]  = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy,     setBusy]     = useState(false);

  const subUrl = `https://${tenant.slug}.${baseDomain}`;
  const url    = tenant.custom_domain ? `https://${tenant.custom_domain}` : subUrl;

  const toggleStatus = async () => {
    setBusy(true);
    try {
      if (tenant.status === 'active') await api.suspendTenant(tenant.slug);
      else await api.activateTenant(tenant.slug);
      onRefresh();
      onToast(`${tenant.slug} ${tenant.status === 'active' ? 'suspended' : 'activated'}`, 'success');
    } catch (e) { onToast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--border)' }}>
        <td style={{ padding: '10px 12px' }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{tenant.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{tenant.slug}</div>
        </td>
        <td style={{ padding: '10px 12px' }}><Badge value={tenant.plan} map={PLAN_COLOURS} /></td>
        <td style={{ padding: '10px 12px' }}><Badge value={tenant.status} map={STATUS_COLOURS} /></td>
        <td style={{ padding: '10px 12px' }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}>{url} ↗</a>
          {tenant.custom_domain && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{subUrl}</div>}
        </td>
        <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {new Date(tenant.created_at).toLocaleDateString()}
        </td>
        <td style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-sm" style={{ background: tenant.status === 'active' ? 'var(--warning)' : 'var(--success)', color:'#fff' }}
              onClick={toggleStatus} disabled={busy}>
              {busy ? '…' : tenant.status === 'active' ? 'Suspend' : 'Activate'}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setDeleting(true)}>Delete</button>
          </div>
        </td>
      </tr>
      {editing  && <EditModal   api={api} tenant={tenant} onClose={() => setEditing(false)}  onDone={() => { setEditing(false);  onRefresh(); onToast('Tenant updated','success'); }} />}
      {deleting && <DeleteModal api={api} tenant={tenant} onClose={() => setDeleting(false)} onDone={() => { setDeleting(false); onRefresh(); onToast('Tenant deleted','success'); }} />}
    </>
  );
}

// ── Key entry ─────────────────────────────────────────────────────────────────

function KeyEntry({ onSubmit }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handle = async () => {
    if (!key.trim()) return setError('Admin key required');
    setChecking(true); setError('');
    try {
      const res = await fetch('/api/host/status', { headers: { 'X-Host-Admin-Key': key.trim() } });
      if (res.ok) { sessionStorage.setItem('rosterchirp-host-key', key.trim()); onSubmit(key.trim()); }
      else setError('Invalid admin key');
    } catch { setError('Connection error'); }
    finally { setChecking(false); }
  };

  return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:360, background:'var(--surface)', borderRadius:'var(--radius-lg)', padding:32, boxShadow:'var(--shadow-md)', textAlign:'center' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5" style={{ marginBottom:12 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <h2 style={{ fontSize:18, fontWeight:700, margin:'0 0 4px' }}>Control Panel</h2>
        <p style={{ color:'var(--text-secondary)', fontSize:13, margin:'0 0 20px' }}>Enter your host admin key to continue.</p>
        {error && <div style={{ padding:'8px 12px', background:'#fce8e6', color:'var(--error)', borderRadius:6, fontSize:13, marginBottom:14 }}>{error}</div>}
        <input type="password" className="input" value={key} onChange={e => setKey(e.target.value)} autoComplete="new-password" onKeyDown={e => e.key === 'Enter' && handle()} placeholder="Host admin key" autoFocus
          style={{ marginBottom:12, textAlign:'center' }} />
        <button className="btn btn-primary" onClick={handle} disabled={checking} style={{ width:'100%', justifyContent:'center' }}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}

// ── Main HostPanel ────────────────────────────────────────────────────────────

export default function HostPanel({ onProfile, onHelp, onAbout }) {
  const { user } = useAuth();
  const [adminKey,  setAdminKey]  = useState(() => sessionStorage.getItem('rosterchirp-host-key') || '');
  const [status,    setStatus]    = useState(null);
  const [tenants,   setTenants]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [search,    setSearch]    = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [migrating,    setMigrating]    = useState(false);
  const [toasts,    setToasts]    = useState([]);

  const api = useHostApi(adminKey);

  const toast = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([api.getStatus(), api.getTenants()]);
      setStatus(s);
      setTenants(t.tenants);
    } catch (e) {
      toast(e.message, 'error');
      // Key is invalid — clear it so the prompt shows again
      if (e.message.includes('401') || e.message.includes('Invalid') || e.message.includes('401')) {
        sessionStorage.removeItem('rosterchirp-host-key');
        setAdminKey('');
      }
    } finally { setLoading(false); }
  }, [api, toast]);

  useEffect(() => { if (adminKey) load(); }, [adminKey]);

  // Guard: must be admin
  if (user?.role !== 'admin') {
    return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)' }}>Access denied.</div>;
  }

  // Key entry screen
  if (!adminKey) return <KeyEntry onSubmit={setAdminKey} />;

  const baseDomain = status?.baseDomain || '';
  const filtered   = tenants.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase()));

  const handleMigrateAll = async () => {
    setMigrating(true);
    try {
      const { results } = await api.migrateAll();
      const errors = results.filter(r => r.status === 'error');
      if (errors.length) toast(`${errors.length} migration(s) failed`, 'error');
      else toast(`Migrations applied to ${results.length} tenant(s)`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setMigrating(false); }
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--background)' }}>
      {/* Header */}
      <div style={{ background:'var(--surface)', borderBottom:'1px solid var(--border)', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', height:52 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span style={{ fontWeight:700, fontSize:15 }}>Control Panel</span>
            {baseDomain && <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>· {baseDomain}</span>}
          </div>
          {status && (
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
              {status.tenants.active} active · {status.tenants.total} total
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      {status && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, padding:'16px 24px', flexShrink:0 }}>
          {[
            { label:'Total',     value: status.tenants.total,                             colour:'var(--primary)' },
            { label:'Active',    value: status.tenants.active,                            colour:'var(--success)' },
            { label:'Suspended', value: status.tenants.total - status.tenants.active,     colour:'var(--warning)' },
          ].map(s => (
            <div key={s.label} style={{ background:'var(--surface)', borderRadius:'var(--radius)', padding:'14px 16px', boxShadow:'var(--shadow-sm)' }}>
              <div style={{ fontSize:24, fontWeight:700, color:s.colour }}>{s.value}</div>
              <div style={{ fontSize:12, color:'var(--text-tertiary)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ padding:'0 24px 12px', flexShrink:0, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} autoComplete="new-password" placeholder="Search tenants…"
          className="input" style={{ flex:1, minWidth:160, fontSize:13 }} autoComplete="new-password" />
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>{loading ? '…' : '↻ Refresh'}</button>
        <button className="btn btn-secondary btn-sm" onClick={handleMigrateAll} disabled={migrating}>{migrating ? 'Migrating…' : '⬆ Migrate All'}</button>
        <button className="btn btn-primary btn-sm" onClick={() => setProvisioning(true)}>+ New Tenant</button>
      </div>

      {/* Table */}
      <div style={{ flex:1, overflowY:'auto', padding:'0 24px 24px' }}>
        <div style={{ background:'var(--surface)', borderRadius:'var(--radius)', boxShadow:'var(--shadow-sm)', overflow:'hidden' }}>
          {loading && tenants.length === 0 ? (
            <div style={{ padding:40, textAlign:'center' }}><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-tertiary)', fontSize:14 }}>
              {search ? 'No tenants match your search.' : 'No tenants yet — provision your first one.'}
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ borderBottom:'2px solid var(--border)' }}>
                    {['Tenant','Plan','Status','URL','Created','Actions'].map(h => (
                      <th key={h} style={{ padding:'8px 12px', textAlign: h==='Actions' ? 'right' : 'left',
                        fontSize:11, fontWeight:700, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.5px', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <TenantRow key={t.slug} tenant={t} baseDomain={baseDomain}
                      api={api} onRefresh={load} onToast={toast} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Provision modal */}
      {provisioning && (
        <ProvisionModal api={api} baseDomain={baseDomain} onClose={() => setProvisioning(false)}
          onDone={tenant => { setProvisioning(false); load(); toast(`Tenant '${tenant.slug}' provisioned`, 'success'); }}
          toast={toast} />
      )}

      {/* Toast notifications */}
      <div style={{ position:'fixed', bottom:24, right:24, display:'flex', flexDirection:'column', gap:8, zIndex:2000 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding:'10px 16px', borderRadius:'var(--radius)', fontSize:13, fontWeight:500,
            background: t.type==='error' ? 'var(--error)' : 'var(--success)',
            color:'#fff', boxShadow:'var(--shadow-md)', maxWidth:320 }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* User footer */}
      <div className="sidebar-footer">
        <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
      </div>
    </div>
  );
}
