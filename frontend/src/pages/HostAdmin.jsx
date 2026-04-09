import { useState, useEffect, useCallback } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

const PLANS = [
  { value: 'chat',  label: 'RosterChirp-Chat',  desc: 'Chat only' },
  { value: 'brand', label: 'RosterChirp-Brand', desc: 'Chat + Branding' },
  { value: 'team',  label: 'RosterChirp-Team',  desc: 'Chat + Branding + Groups + Schedule' },
];

const PLAN_BADGE = {
  chat:  { bg: '#e8f0fe', color: '#1a73e8', label: 'Chat'  },
  brand: { bg: '#fce8b2', color: '#e37400', label: 'Brand' },
  team:  { bg: '#e6f4ea', color: '#188038', label: 'Team'  },
};

const STATUS_BADGE = {
  active:    { bg: '#e6f4ea', color: '#188038' },
  suspended: { bg: '#fce8b2', color: '#e37400' },
};

// ── API helpers ───────────────────────────────────────────────────────────────

function useHostApi(adminKey) {
  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`/api/host${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Host-Admin-Key': adminKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [adminKey]);

  return {
    getStatus:   ()         => call('GET',    '/status'),
    getTenants:  ()         => call('GET',    '/tenants'),
    createTenant: (body)    => call('POST',   '/tenants', body),
    updateTenant: (slug, b) => call('PATCH',  `/tenants/${slug}`, b),
    deleteTenant: (slug)    => call('DELETE', `/tenants/${slug}`, { confirm: `DELETE ${slug}` }),
    suspendTenant:(slug)    => call('PATCH',  `/tenants/${slug}`, { status: 'suspended' }),
    activateTenant:(slug)   => call('PATCH',  `/tenants/${slug}`, { status: 'active' }),
    migrateAll:  ()         => call('POST',   '/migrate-all'),
  };
}

// ── Small reusable components ─────────────────────────────────────────────────

function Badge({ value, map }) {
  const s = map[value] || { bg: '#f1f3f4', color: '#5f6368' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
      {s.label || value}
    </span>
  );
}

function Btn({ onClick, children, variant = 'secondary', size = 'md', disabled, style = {} }) {
  const base = {
    border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
    opacity: disabled ? 0.5 : 1, transition: 'opacity 0.15s',
    padding: size === 'sm' ? '5px 12px' : '9px 18px',
    fontSize: size === 'sm' ? 12 : 14,
  };
  const variants = {
    primary:  { background: '#1a73e8', color: '#fff' },
    danger:   { background: '#d93025', color: '#fff' },
    warning:  { background: '#e37400', color: '#fff' },
    success:  { background: '#188038', color: '#fff' },
    secondary:{ background: '#f1f3f4', color: '#202124' },
    ghost:    { background: 'transparent', color: '#5f6368', padding: size === 'sm' ? '4px 8px' : '8px 12px' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, placeholder, type = 'text', required, hint, autoComplete }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 12, fontWeight: 600, color: '#5f6368' }}>
          {label}{required && <span style={{ color: '#d93025', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        autoComplete={autoComplete || 'new-password'} autoCorrect="off" spellCheck={false}
        style={{ padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 6,
          fontSize: 14, outline: 'none', background: '#fff', color: '#202124',
          transition: 'border-color 0.15s' }}
        onFocus={e => e.target.style.borderColor = '#1a73e8'}
        onBlur={e => e.target.style.borderColor = '#e0e0e0'} />
      {hint && <span style={{ fontSize: 11, color: '#9aa0a6' }}>{hint}</span>}
    </div>
  );
}

function Select({ label, value, onChange, options, required }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: '#5f6368' }}>{label}{required && <span style={{ color: '#d93025', marginLeft: 2 }}>*</span>}</label>}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 6,
          fontSize: 14, outline: 'none', background: '#fff', color: '#202124' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}{o.desc ? ` — ${o.desc}` : ''}</option>)}
      </select>
    </div>
  );
}

function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: width,
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid #e0e0e0' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 20, color: '#9aa0a6', lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

function Toast({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column',
      gap: 8, zIndex: 2000 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ padding: '12px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: t.type === 'error' ? '#d93025' : t.type === 'warning' ? '#e37400' : '#188038',
          color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', maxWidth: 360 }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── Provision tenant modal ─────────────────────────────────────────────────────

function ProvisionModal({ api, baseDomain, onClose, onDone }) {
  const [form, setForm] = useState({
    slug: '', name: '', plan: 'chat',
    adminEmail: '', adminName: 'Admin User', adminPass: '',
    customDomain: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = k => v => setForm(f => ({ ...f, [k]: v }));

  const handle = async () => {
    if (!form.slug || !form.name) return setError('Slug and name are required');
    setSaving(true); setError('');
    try {
      const { tenant } = await api.createTenant({
        slug:         form.slug.toLowerCase().trim(),
        name:         form.name.trim(),
        plan:         form.plan,
        adminEmail:   form.adminEmail || undefined,
        adminName:    form.adminName  || undefined,
        adminPass:    form.adminPass  || undefined,
        customDomain: form.customDomain || undefined,
      });
      onDone(tenant);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const preview = form.slug ? `${form.slug.toLowerCase()}.${baseDomain}` : '';

  return (
    <Modal title="Provision New Tenant" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ padding: '10px 14px', background: '#fce8e6', color: '#d93025',
          borderRadius: 6, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input label="Slug" value={form.slug} onChange={set('slug')} required
            placeholder="team-alpha"
            hint={preview ? `URL: ${preview}` : 'Used as subdomain + schema name'} />
          <Input label="Display Name" value={form.name} onChange={set('name')} required placeholder="Team Alpha" />
        </div>

        <Select label="Plan" value={form.plan} onChange={set('plan')} options={PLANS} required />

        <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa0a6', textTransform: 'uppercase',
            letterSpacing: '0.5px', marginBottom: 12 }}>First Admin User (optional — defaults to .env values)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Admin Email" value={form.adminEmail} onChange={set('adminEmail')}
              placeholder="admin@teamalpha.com" type="email" />
            <Input label="Admin Name" value={form.adminName} onChange={set('adminName')}
              placeholder="Admin User" />
            <Input label="Temp Password" value={form.adminPass} onChange={set('adminPass')}
              placeholder="Auto-generated if blank" type="text" />
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: 12 }}>
          <Input label="Custom Domain (optional)" value={form.customDomain} onChange={set('customDomain')}
            placeholder="chat.teamalpha.com"
            hint="Tenant can also be reached at this domain once DNS is configured" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <Btn onClick={onClose} variant="secondary">Cancel</Btn>
          <Btn onClick={handle} variant="primary" disabled={saving}>
            {saving ? 'Provisioning…' : '✦ Provision Tenant'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit tenant modal ──────────────────────────────────────────────────────────

function EditModal({ api, tenant, onClose, onDone }) {
  const [form, setForm] = useState({
    name: tenant.name, plan: tenant.plan, customDomain: tenant.custom_domain || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => v => setForm(f => ({ ...f, [k]: v }));

  const handle = async () => {
    setSaving(true); setError('');
    try {
      const { tenant: updated } = await api.updateTenant(tenant.slug, {
        name: form.name || undefined,
        plan: form.plan,
        customDomain: form.customDomain || null,
      });
      onDone(updated);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Edit — ${tenant.slug}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ padding: '10px 14px', background: '#fce8e6', color: '#d93025',
          borderRadius: 6, fontSize: 13 }}>{error}</div>}
        <Input label="Display Name" value={form.name} onChange={set('name')} required />
        <Select label="Plan" value={form.plan} onChange={set('plan')} options={PLANS} />
        <Input label="Custom Domain" value={form.customDomain} onChange={set('customDomain')}
          placeholder="chat.example.com" hint="Leave blank to remove custom domain" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn onClick={onClose} variant="secondary">Cancel</Btn>
          <Btn onClick={handle} variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Delete confirmation modal ──────────────────────────────────────────────────

function DeleteModal({ api, tenant, onClose, onDone }) {
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const expected = `DELETE ${tenant.slug}`;

  const handle = async () => {
    setDeleting(true); setError('');
    try {
      await api.deleteTenant(tenant.slug);
      onDone(tenant.slug);
    } catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  };

  return (
    <Modal title="Delete Tenant" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ padding: '12px 16px', background: '#fce8e6', borderRadius: 8, fontSize: 13, color: '#d93025' }}>
          <strong>This is permanent.</strong> The tenant's Postgres schema and all data —
          messages, events, users, uploads — will be deleted and cannot be recovered.
        </div>
        <div style={{ fontSize: 14, color: '#202124' }}>
          To confirm, type <code style={{ background: '#f1f3f4', padding: '2px 6px',
          borderRadius: 4, fontFamily: 'monospace' }}>{expected}</code> below:
        </div>
        {error && <div style={{ color: '#d93025', fontSize: 13 }}>{error}</div>}
        <Input value={confirm} onChange={setConfirm} placeholder={expected} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn onClick={onClose} variant="secondary">Cancel</Btn>
          <Btn onClick={handle} variant="danger" disabled={confirm !== expected || deleting}>
            {deleting ? 'Deleting…' : 'Permanently Delete'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Tenant row ────────────────────────────────────────────────────────────────

function TenantRow({ tenant, baseDomain, api, onRefresh, onToast }) {
  const [editing, setEditing]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy]         = useState(false);
  const subdomainUrl  = `https://${tenant.slug}.${baseDomain}`;
  const url = tenant.custom_domain ? `https://${tenant.custom_domain}` : subdomainUrl;

  const toggleStatus = async () => {
    setBusy(true);
    try {
      if (tenant.status === 'active') await api.suspendTenant(tenant.slug);
      else await api.activateTenant(tenant.slug);
      onRefresh();
      onToast(`Tenant ${tenant.slug} ${tenant.status === 'active' ? 'suspended' : 'activated'}`, 'success');
    } catch (e) { onToast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
        <td style={{ padding: '12px 16px' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{tenant.name}</div>
          <div style={{ fontSize: 12, color: '#9aa0a6', fontFamily: 'monospace' }}>{tenant.slug}</div>
        </td>
        <td style={{ padding: '12px 16px' }}>
          <Badge value={tenant.plan} map={PLAN_BADGE} />
        </td>
        <td style={{ padding: '12px 16px' }}>
          <Badge value={tenant.status} map={STATUS_BADGE} />
        </td>
        <td style={{ padding: '12px 16px' }}>
          <a href={url} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: '#1a73e8', textDecoration: 'none' }}>
            {url} ↗
          </a>
          {tenant.custom_domain && (
            <div style={{ fontSize: 11, color: '#9aa0a6' }}>{subdomainUrl}</div>
          )}
        </td>
        <td style={{ padding: '12px 16px', fontSize: 12, color: '#9aa0a6', whiteSpace: 'nowrap' }}>
          {new Date(tenant.created_at).toLocaleDateString()}
        </td>
        <td style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Btn>
            <Btn size="sm" variant={tenant.status === 'active' ? 'warning' : 'success'}
              onClick={toggleStatus} disabled={busy}>
              {busy ? '…' : tenant.status === 'active' ? 'Suspend' : 'Activate'}
            </Btn>
            <Btn size="sm" variant="danger" onClick={() => setDeleting(true)}>Delete</Btn>
          </div>
        </td>
      </tr>

      {editing && (
        <EditModal api={api} tenant={tenant} onClose={() => setEditing(false)}
          onDone={() => { setEditing(false); onRefresh(); onToast('Tenant updated', 'success'); }} />
      )}
      {deleting && (
        <DeleteModal api={api} tenant={tenant} onClose={() => setDeleting(false)}
          onDone={() => { setDeleting(false); onRefresh(); onToast('Tenant deleted', 'success'); }} />
      )}
    </>
  );
}

// ── Key entry screen ──────────────────────────────────────────────────────────

function KeyEntry({ onSubmit }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const handle = async () => {
    if (!key.trim()) return setError('Admin key required');
    setError('');
    const res = await fetch('/api/host/status', {
      headers: { 'X-Host-Admin-Key': key.trim() },
    });
    if (res.ok) {
      sessionStorage.setItem('rosterchirp-host-key', key.trim());
      onSubmit(key.trim());
    } else {
      setError('Invalid admin key');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f1f3f4' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 40, width: '100%', maxWidth: 380,
        boxShadow: '0 2px 16px rgba(0,0,0,0.12)', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🏠</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>RosterChirp-Host</h1>
        <p style={{ color: '#5f6368', fontSize: 13, margin: '0 0 24px' }}>Host Administration Panel</p>
        {error && <div style={{ padding: '8px 12px', background: '#fce8e6', color: '#d93025',
          borderRadius: 6, fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <input
          type="password" value={key} onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handle()}
          placeholder="Host admin key" autoFocus
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 6,
            fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
               autoComplete="new-password" />
        <Btn onClick={handle} variant="primary" style={{ width: '100%', justifyContent: 'center' }}>
          Sign In
        </Btn>
      </div>
    </div>
  );
}

// ── Main host admin panel ─────────────────────────────────────────────────────

export default function HostAdmin() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('rosterchirp-host-key') || '');
  const [status,   setStatus]   = useState(null);
  const [tenants,  setTenants]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [migrating,    setMigrating]    = useState(false);
  const [toasts,  setToasts]    = useState([]);
  const [search,  setSearch]    = useState('');

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
      if (e.message.includes('Invalid') || e.message.includes('401')) {
        sessionStorage.removeItem('rosterchirp-host-key');
        setAdminKey('');
      }
    } finally { setLoading(false); }
  }, [api, toast]);

  useEffect(() => { if (adminKey) load(); }, [adminKey]);

  const handleMigrateAll = async () => {
    setMigrating(true);
    try {
      const { results } = await api.migrateAll();
      const errors = results.filter(r => r.status === 'error');
      if (errors.length) toast(`${errors.length} migration(s) failed — check logs`, 'error');
      else toast(`Migrations applied to ${results.length} tenant(s)`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setMigrating(false); }
  };

  if (!adminKey) return <KeyEntry onSubmit={setAdminKey} />;

  const filtered = tenants.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase())
  );
  const baseDomain = status?.baseDomain || 'rosterchirp.com';

  return (
    <div style={{ minHeight: '100vh', background: '#f1f3f4', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1a73e8', color: '#fff', padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🏠</span>
            <span style={{ fontWeight: 700, fontSize: 16 }}>RosterChirp-Host</span>
            <span style={{ opacity: 0.7, fontSize: 13 }}>/ {baseDomain}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {status && (
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                {status.tenants.active} active · {status.tenants.total} total
              </span>
            )}
            <Btn size="sm" variant="secondary" onClick={() => { sessionStorage.removeItem('rosterchirp-host-key'); setAdminKey(''); }}>
              Sign Out
            </Btn>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>

        {/* Stat cards */}
        {status && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'Total Tenants',  value: status.tenants.total,                     color: '#1a73e8' },
              { label: 'Active',         value: status.tenants.active,                    color: '#188038' },
              { label: 'Suspended',      value: status.tenants.total - status.tenants.active, color: '#e37400' },
              { label: 'Mode',           value: status.appType,                           color: '#5f6368' },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '16px 20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#9aa0a6', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid #e0e0e0', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Tenants</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search tenants…" autoComplete="off"
                style={{ padding: '7px 10px', border: '1px solid #e0e0e0', borderRadius: 6,
                  fontSize: 13, outline: 'none', width: 200 }} />
              <Btn size="sm" variant="secondary" onClick={load} disabled={loading}>
                {loading ? '…' : '↻ Refresh'}
              </Btn>
              <Btn size="sm" variant="secondary" onClick={handleMigrateAll} disabled={migrating}>
                {migrating ? 'Migrating…' : '⬆ Migrate All'}
              </Btn>
              <Btn size="sm" variant="primary" onClick={() => setProvisioning(true)}>
                ✦ New Tenant
              </Btn>
            </div>
          </div>

          {/* Table */}
          {loading && tenants.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>
              {search ? 'No tenants match your search.' : 'No tenants yet. Provision your first one!'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    {['Tenant', 'Plan', 'Status', 'URL', 'Created', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: h === 'Actions' ? 'right' : 'left',
                        fontSize: 11, fontWeight: 700, color: '#9aa0a6', textTransform: 'uppercase',
                        letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
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

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#9aa0a6' }}>
          RosterChirp-Host Control Plane · {baseDomain}
        </div>
      </div>

      {/* Provision modal */}
      {provisioning && (
        <ProvisionModal api={api} baseDomain={baseDomain} onClose={() => setProvisioning(false)}
          onDone={tenant => {
            setProvisioning(false);
            load();
            toast(`Tenant '${tenant.slug}' provisioned at https://${tenant.slug}.${baseDomain}`, 'success');
          }} />
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
