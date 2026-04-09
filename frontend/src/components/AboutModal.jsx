import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

const CLAUDE_URL = 'https://claude.ai';

// Render "Built With" value — each token+separator is a nowrap unit; the flex
// container wraps between tokens. Using display:flex (not inline) ensures Firefox
// and Safari honour the wrap at the flex-item level rather than computing the
// min-content width as the full un-broken string (which suppresses wrapping).
function BuiltWithValue({ value }) {
  if (!value) return null;
  const parts = value.split('·').map(s => s.trim());
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', width: '100%' }}>
      {parts.map((part, i) => (
        <span key={part} style={{ whiteSpace: 'nowrap' }}>
          {part === 'Claude.ai'
            ? <a href={CLAUDE_URL} target="_blank" rel="noreferrer" className="about-link">{part}</a>
            : part}
          {i < parts.length - 1 && <span style={{ margin: '0 4px', color: 'var(--text-tertiary)' }}>·</span>}
        </span>
      ))}
    </span>
  );
}

export default function AboutModal({ onClose }) {
  const [about, setAbout] = useState(null);

  useEffect(() => {
    fetch('/api/about')
      .then(r => r.json())
      .then(({ about }) => setAbout(about))
      .catch(() => {});
  }, []);

  // Always use the original app identity — not the user-customised settings name/logo
  const appName = about?.default_app_name || 'rosterchirp';
  const logoSrc = about?.default_logo || '/icons/rosterchirp.png';
  const version = about?.version || '';
  const a = about || {};

  const rows = [
    { label: 'Version',    value: version },
    { label: 'Built With', value: a.built_with, builtWith: true },
    { label: 'Developer',  value: a.developer },
    { label: 'License',    value: a.license, link: a.license_url },
  ].filter(r => r.value);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal about-modal">
        <button className="btn-icon about-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="about-hero">
          <img src={logoSrc} alt={appName} className="about-logo" />
          <h1 className="about-appname">{appName}</h1>
          <p className="about-tagline">just another messaging app</p>
        </div>

        {about ? (
          <>
            <div className="about-table">
              {rows.map(({ label, value, builtWith, link }) => (
                <div className="about-row" key={label}>
                  <span className="about-label">{label}</span>
                  <span className="about-value">
                    {builtWith
                      ? <BuiltWithValue value={value} />
                      : link
                        ? <a href={link} target="_blank" rel="noreferrer" className="about-link">{value}</a>
                        : value}
                  </span>
                </div>
              ))}
            </div>
            {a.description && <p className="about-footer">{a.description}</p>}
          </>
        ) : (
          <div className="flex justify-center" style={{ padding: 24 }}><div className="spinner" /></div>
        )}
      </div>
    </div>
  );
}
