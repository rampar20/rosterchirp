import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const DEFAULT_TITLE_COLOR      = '#1a73e8'; // light mode default
const DEFAULT_TITLE_DARK_COLOR = '#60a5fa'; // dark mode default (lighter blue readable on dark bg)
const DEFAULT_PUBLIC_COLOR = '#1a73e8';
const DEFAULT_DM_COLOR     = '#a142f4';

const COLOUR_SUGGESTIONS = [
  '#1a73e8', '#a142f4', '#e53935', '#fa7b17', '#fdd835', '#34a853',
];

// ── Title Colour Row — one row per mode ──────────────────────────────────────

function TitleColourRow({ bgColor, bgLabel, textColor, onChange }) {
  const [mode, setMode] = useState('idle'); // 'idle' | 'custom'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {/* Preview box */}
      <div style={{
        background: bgColor, borderRadius: 8, padding: '0 14px',
        height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border)', minWidth: 110, flexShrink: 0,
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      }}>
        <span style={{ color: textColor, fontWeight: 700, fontSize: 16 }}>
          Title
        </span>
      </div>

      {mode === 'idle' && (
        <>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace', minWidth: 64 }}>{textColor}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setMode('custom')}>Custom</button>
        </>
      )}

      {mode === 'custom' && (
        <div style={{ flex: 1 }}>
          <CustomPicker
            initial={textColor}
            onSet={(hex) => { onChange(hex); setMode('idle'); }}
            onBack={() => setMode('idle')} />
        </div>
      )}
    </div>
  );
}

// ── Colour math helpers ──────────────────────────────────────────────────────

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h, s, v) {
  h = h / 360;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r=v; g=t; b=p; break; case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break; case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break; default: r=v; g=p; b=q;
  }
  return '#' + [r,g,b].map(x => Math.round(x*255).toString(16).padStart(2,'0')).join('');
}

function isValidHex(h) { return /^#[0-9a-fA-F]{6}$/.test(h); }

// ── SV (saturation/value) square ─────────────────────────────────────────────

function SvSquare({ hue, s, v, onChange }) {
  const canvasRef = useRef(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    // White → hue gradient (left→right)
    const hGrad = ctx.createLinearGradient(0, 0, W, 0);
    hGrad.addColorStop(0, '#fff');
    hGrad.addColorStop(1, `hsl(${hue},100%,50%)`);
    ctx.fillStyle = hGrad; ctx.fillRect(0, 0, W, H);
    // Transparent → black gradient (top→bottom)
    const vGrad = ctx.createLinearGradient(0, 0, 0, H);
    vGrad.addColorStop(0, 'transparent');
    vGrad.addColorStop(1, '#000');
    ctx.fillStyle = vGrad; ctx.fillRect(0, 0, W, H);
  }, [hue]);

  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return {
      s: Math.max(0, Math.min(1, cx / r.width)),
      v: Math.max(0, Math.min(1, 1 - cy / r.height)),
    };
  };

  const handle = (e) => {
    e.preventDefault();
    const p = getPos(e, canvasRef.current);
    onChange(p.s, p.v);
  };

  return (
    <div style={{ position: 'relative', userSelect: 'none', touchAction: 'none' }}>
      <canvas
        ref={canvasRef} width={260} height={160}
        style={{ display: 'block', width: '100%', height: 160, borderRadius: 8, cursor: 'crosshair', border: '1px solid var(--border)' }}
        onMouseDown={e => { dragging.current = true; handle(e); }}
        onMouseMove={e => { if (dragging.current) handle(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
        onTouchStart={handle} onTouchMove={handle} />
      {/* Cursor circle */}
      <div style={{
        position: 'absolute',
        left: `calc(${s * 100}% - 7px)`,
        top: `calc(${(1 - v) * 100}% - 7px)`,
        width: 14, height: 14, borderRadius: '50%',
        border: '2px solid white',
        boxShadow: '0 0 0 1.5px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
        background: 'transparent',
      }} />
    </div>
  );
}

// ── Hue bar ───────────────────────────────────────────────────────────────────

function HueBar({ hue, onChange }) {
  const barRef = useRef(null);
  const dragging = useRef(false);

  const handle = (e) => {
    e.preventDefault();
    const r = barRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    onChange(Math.max(0, Math.min(360, (cx / r.width) * 360)));
  };

  return (
    <div style={{ position: 'relative', userSelect: 'none', touchAction: 'none', marginTop: 10 }}>
      <div
        ref={barRef}
        style={{
          height: 20, borderRadius: 10,
          background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)',
          border: '1px solid var(--border)', cursor: 'pointer',
        }}
        onMouseDown={e => { dragging.current = true; handle(e); }}
        onMouseMove={e => { if (dragging.current) handle(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
        onTouchStart={handle} onTouchMove={handle} />
      <div style={{
        position: 'absolute',
        left: `calc(${(hue / 360) * 100}% - 9px)`,
        top: -2, width: 18, height: 24, borderRadius: 4,
        background: `hsl(${hue},100%,50%)`,
        border: '2px solid white',
        boxShadow: '0 0 0 1.5px rgba(0,0,0,0.3)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// ── Custom HSV picker ─────────────────────────────────────────────────────────

function CustomPicker({ initial, onSet, onBack }) {
  const { h: ih, s: is, v: iv } = hexToHsv(initial);
  const [hue, setHue] = useState(ih);
  const [sat, setSat] = useState(is);
  const [val, setVal] = useState(iv);
  const [hexInput, setHexInput] = useState(initial);
  const [hexError, setHexError] = useState(false);

  const current = hsvToHex(hue, sat, val);

  // Sync hex input when sliders change
  useEffect(() => { setHexInput(current); setHexError(false); }, [current]);

  const handleHexInput = (e) => {
    const v = e.target.value;
    setHexInput(v);
    if (isValidHex(v)) {
      const { h, s, v: bv } = hexToHsv(v);
      setHue(h); setSat(s); setVal(bv);
      setHexError(false);
    } else {
      setHexError(true);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SvSquare hue={hue} s={sat} v={val} onChange={(s, v) => { setSat(s); setVal(v); }} />
      <HueBar hue={hue} onChange={setHue} />

      {/* Preview + hex input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8, background: current,
          border: '2px solid var(--border)', flexShrink: 0,
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }} />
        <input
          value={hexInput}
          onChange={handleHexInput}
          maxLength={7}
          style={{
            fontFamily: 'monospace', fontSize: 14,
            padding: '6px 10px', borderRadius: 8,
            border: `1px solid ${hexError ? '#e53935' : 'var(--border)'}`,
            width: 110, background: 'var(--surface)',
            color: 'var(--text-primary)',
          }}
          placeholder="#000000" autoComplete="off" />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Chosen colour</span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button className="btn btn-primary btn-sm" onClick={() => onSet(current)} disabled={hexError}>
          Set
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

// ── ColourPicker card ─────────────────────────────────────────────────────────

function ColourPicker({ label, value, onChange, preview }) {
  const [mode, setMode] = useState('suggestions'); // 'suggestions' | 'custom'

  return (
    <div>
      <div className="settings-section-label">{label}</div>

      {/* Current colour preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {preview
          ? preview(value)
          : <div style={{ width: 36, height: 36, borderRadius: 8, background: value, border: '2px solid var(--border)', flexShrink: 0 }} />
        }
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{value}</span>
      </div>

      {mode === 'suggestions' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {COLOUR_SUGGESTIONS.map(hex => (
              <button
                key={hex}
                onClick={() => onChange(hex)}
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: hex, border: hex === value ? '3px solid var(--text-primary)' : '2px solid var(--border)',
                  cursor: 'pointer', flexShrink: 0,
                  boxShadow: hex === value ? '0 0 0 2px var(--surface), 0 0 0 4px var(--text-primary)' : 'none',
                  transition: 'box-shadow 0.15s',
                }}
                title={hex} />
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setMode('custom')}>
            Custom
          </button>
        </>
      )}

      {mode === 'custom' && (
        <CustomPicker
          initial={value}
          onSet={(hex) => { onChange(hex); setMode('suggestions'); }}
          onBack={() => setMode('suggestions')} />
      )}
    </div>
  );
}

export default function BrandingModal({ onClose }) {
  const toast = useToast();
  const [tab, setTab] = useState('general'); // 'general' | 'colours'
  const [settings, setSettings] = useState({});
  const [appName, setAppName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [colourTitle, setColourTitle]         = useState(DEFAULT_TITLE_COLOR);
  const [colourTitleDark, setColourTitleDark] = useState(DEFAULT_TITLE_DARK_COLOR);
  const [colourPublic, setColourPublic] = useState(DEFAULT_PUBLIC_COLOR);
  const [colourDm, setColourDm]         = useState(DEFAULT_DM_COLOR);
  const [savingColours, setSavingColours] = useState(false);

  useEffect(() => {
    api.getSettings().then(({ settings }) => {
      setSettings(settings);
      setAppName(settings.app_name || 'rosterchirp');
      setColourTitle(settings.color_title || DEFAULT_TITLE_COLOR);
      setColourTitleDark(settings.color_title_dark || DEFAULT_TITLE_DARK_COLOR);
      setColourPublic(settings.color_avatar_public || DEFAULT_PUBLIC_COLOR);
      setColourDm(settings.color_avatar_dm || DEFAULT_DM_COLOR);
    }).catch(() => {});
  }, []);

  const notifySidebarRefresh = () => window.dispatchEvent(new Event('rosterchirp:settings-changed'));

  const handleSaveName = async () => {
    if (!appName.trim()) return;
    setLoading(true);
    try {
      await api.updateAppName(appName.trim());
      setSettings(prev => ({ ...prev, app_name: appName.trim() }));
      toast('App name updated', 'success');
      notifySidebarRefresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) return toast('Logo must be less than 1MB', 'error');
    try {
      const { logoUrl } = await api.uploadLogo(file);
      setSettings(prev => ({ ...prev, logo_url: logoUrl }));
      toast('Logo updated', 'success');
      notifySidebarRefresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const handleSaveColours = async () => {
    setSavingColours(true);
    try {
      await api.updateColors({
        colorTitle: colourTitle,
        colorTitleDark: colourTitleDark,
        colorAvatarPublic: colourPublic,
        colorAvatarDm: colourDm,
      });
      setSettings(prev => ({
        ...prev,
        color_title: colourTitle,
        color_title_dark: colourTitleDark,
        color_avatar_public: colourPublic,
        color_avatar_dm: colourDm,
      }));
      toast('Colours updated', 'success');
      notifySidebarRefresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingColours(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.resetSettings();
      const { settings: fresh } = await api.getSettings();
      setSettings(fresh);
      setAppName(fresh.app_name || 'rosterchirp');
      setColourTitle(DEFAULT_TITLE_COLOR);
      setColourTitleDark(DEFAULT_TITLE_DARK_COLOR);
      setColourPublic(DEFAULT_PUBLIC_COLOR);
      setColourDm(DEFAULT_DM_COLOR);
      toast('Settings reset to defaults', 'success');
      notifySidebarRefresh();
      setShowResetConfirm(false);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Branding</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2" style={{ marginBottom: 24 }}>
          <button className={`btn btn-sm ${tab === 'general' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('general')}>General</button>
          <button className={`btn btn-sm ${tab === 'colours' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('colours')}>Colours</button>
        </div>

        {tab === 'general' && (
          <>
            {/* App Logo */}
            <div style={{ marginBottom: 24 }}>
              <div className="settings-section-label">App Logo</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: 16, background: 'var(--background)',
                  border: '1px solid var(--border)', overflow: 'hidden', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <img src={settings.logo_url || '/icons/rosterchirp.png'} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <div>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
                    Upload Logo
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
                  </label>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
                    Square format, max 1MB. Used in sidebar, login page and browser tab.
                  </p>
                </div>
              </div>
            </div>

            {/* App Name */}
            <div style={{ marginBottom: 24 }}>
              <div className="settings-section-label">App Name</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input flex-1"
                  value={appName}
                  maxLength={16}
                  onChange={e => setAppName(e.target.value)} autoComplete="off" onKeyDown={e => e.key === 'Enter' && handleSaveName()} />
                <button className="btn btn-primary btn-sm" onClick={handleSaveName} disabled={loading}>{loading ? '...' : 'Save'}</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
                Maximum 16 characters including spaces. Currently {appName.length}/16.
              </p>
            </div>

            {/* Reset */}
            <div style={{ marginBottom: settings.pw_reset_active === 'true' ? 16 : 0 }}>
              <div className="settings-section-label">Reset</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                {!showResetConfirm ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowResetConfirm(true)}>Reset All to Defaults</button>
                ) : (
                  <div style={{ background: '#fce8e6', border: '1px solid #f5c6c2', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                    <p style={{ fontSize: 13, color: 'var(--error)', marginBottom: 12 }}>
                      This will reset the app name, logo and all colours to their install defaults. This cannot be undone.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm" style={{ background: 'var(--error)', color: 'white' }} onClick={handleReset} disabled={resetting}>
                        {resetting ? 'Resetting...' : 'Yes, Reset Everything'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowResetConfirm(false)}>Cancel</button>
                    </div>
                  </div>
                )}
                {settings.app_version && (
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>v{settings.app_version}</span>
                )}
              </div>
            </div>

            {settings.pw_reset_active === 'true' && (
              <div className="warning-banner">
                <span>⚠️</span>
                <span><strong>ADMPW_RESET is active.</strong> The default admin password is being reset on every restart. Set ADMPW_RESET=false in your environment variables to stop this.</span>
              </div>
            )}
          </>
        )}

        {tab === 'colours' && (
          <div className="flex-col gap-3">
            <div>
              <div className="settings-section-label">App Title Colour</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                <TitleColourRow
                  bgColor="#f1f3f4"
                  bgLabel="Light mode"
                  textColor={colourTitle}
                  onChange={setColourTitle} />
                <TitleColourRow
                  bgColor="#13131f"
                  bgLabel="Dark mode"
                  textColor={colourTitleDark}
                  onChange={setColourTitleDark} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <ColourPicker
                label="Public Message Avatar Colour"
                value={colourPublic}
                onChange={setColourPublic}
                preview={(val) => (
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', background: val,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0,
                  }}>A</div>
                )} />
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <ColourPicker
                label="Direct Message Avatar Colour"
                value={colourDm}
                onChange={setColourDm}
                preview={(val) => (
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', background: val,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0,
                  }}>B</div>
                )} />
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <button className="btn btn-primary" onClick={handleSaveColours} disabled={savingColours}>
                {savingColours ? 'Saving...' : 'Save Colours'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
