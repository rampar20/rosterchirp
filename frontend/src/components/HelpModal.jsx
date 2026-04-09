import { useState, useEffect } from 'react';
import { marked } from 'marked';
import { api } from '../utils/api.js';

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

export default function HelpModal({ onClose, dismissed: initialDismissed }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(!!initialDismissed);

  useEffect(() => {
    api.getHelp()
      .then(({ content }) => setContent(content))
      .catch(() => setContent('# Getting Started\n\nHelp content could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const handleDismissToggle = async (e) => {
    const val = e.target.checked;
    setDismissed(val);
    try {
      await api.dismissHelp(val);
    } catch (_) {}
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal help-modal">

        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Getting Started</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Scrollable markdown content */}
        <div className="help-content">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading…</div>
          ) : (
            <div
              className="help-markdown"
              dangerouslySetInnerHTML={{ __html: marked.parse(content) }} />
          )}
        </div>

        {/* Footer */}
        <div className="help-footer">
          <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={dismissed}
              onChange={handleDismissToggle} />
            Do not show again at login
          </label>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
        </div>

      </div>
    </div>
  );
}
