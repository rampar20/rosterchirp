import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

function generateCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const ops = [
    { label: `${a} + ${b}`, answer: a + b },
    { label: `${a + b} - ${b}`, answer: a },
    { label: `${a} × ${b}`, answer: a * b },
  ];
  return ops[Math.floor(Math.random() * ops.length)];
}

export default function SupportModal({ onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captcha, setCaptcha] = useState(generateCaptcha);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const refreshCaptcha = () => {
    setCaptcha(generateCaptcha());
    setCaptchaAnswer('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !email.trim() || !message.trim()) {
      return setError('Please fill in all fields.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setError('Please enter a valid email address.');
    }
    if (parseInt(captchaAnswer, 10) !== captcha.answer) {
      setError('Incorrect answer — please try again.');
      refreshCaptcha();
      return;
    }

    setLoading(true);
    try {
      await api.submitSupport({ name, email, message });
      setSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send. Please try again.');
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        {sent ? (
          /* Success state */
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: '#e6f4ea', display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 16px'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34a853" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Message Sent</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
              Your message has been received. An administrator will follow up with you shortly.
            </p>
            <button className="btn btn-primary" onClick={onClose} style={{ minWidth: 120 }}>
              Close
            </button>
          </div>
        ) : (
          /* Form state */
          <>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Contact Support</h2>
              <button className="btn-icon" onClick={onClose}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Fill out the form below and an administrator will get back to you.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Your Name</label>
                <input
                  className="input"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={e => setName(e.target.value)} autoComplete="new-password" maxLength={100} />
              </div>

              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Your Email</label>
                <input
                  className="input"
                  type="email"
                  placeholder="jane@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)} autoComplete="new-password" maxLength={200} />
              </div>

              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Message</label>
                <textarea
                  className="input"
                  placeholder="Describe your issue or question..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  style={{ resize: 'vertical' }} />
                <span className="text-xs" style={{ color: 'var(--text-tertiary)', alignSelf: 'flex-end' }}>
                  {message.length}/2000
                </span>
              </div>

              {/* Math captcha */}
              <div className="flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Security Check
                </label>
                <div className="flex items-center gap-2" style={{ gap: 10 }}>
                  <div style={{
                    background: 'var(--background)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '9px 16px',
                    fontSize: 15, fontWeight: 700, letterSpacing: 2,
                    color: 'var(--text-primary)', fontFamily: 'monospace',
                    flexShrink: 0, userSelect: 'none'
                  }}>
                    {captcha.label} = ?
                  </div>
                  <input
                    className="input"
                    type="number"
                    placeholder="Answer"
                    value={captchaAnswer}
                    onChange={e => setCaptchaAnswer(e.target.value)}
                    style={{ width: 90 }}
                    min={0}
                    max={999} />
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={refreshCaptcha}
                    title="New question"
                    style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                </div>
              </div>

              {error && (
                <div style={{
                  background: '#fce8e6', border: '1px solid #f5c6c2',
                  borderRadius: 'var(--radius)', padding: '10px 14px',
                  fontSize: 13, color: 'var(--error)'
                }}>
                  {error}
                </div>
              )}

              <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
                {loading
                  ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Sending...</>
                  : 'Send Message'
                }
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
