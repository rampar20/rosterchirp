import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../utils/api.js';
import './Login.css';
import SupportModal from '../components/SupportModal.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [settings, setSettings] = useState({});
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    api.getSettings().then(({ settings }) => setSettings(settings)).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await login(email, password, rememberMe);
      if (data.mustChangePassword) {
        nav('/change-password');
      } else {
        nav('/');
      }
    } catch (err) {
      if (err.message === 'suspended') {
        toast(`Your account has been suspended. Contact: ${err.adminEmail || 'your admin'} for assistance.`, 'error', 8000);
      } else {
        toast(err.message || 'Login failed', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle suspension error from API directly
  const handleLoginError = async (email, password, rememberMe) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'suspended') {
          toast(`Your account has been suspended. Contact ${data.adminEmail || 'your administrator'} for assistance.`, 'error', 8000);
        } else {
          toast(data.error || 'Login failed', 'error');
        }
        return;
      }
      // Success handled by login function above
    } finally {
      setLoading(false);
    }
  };

  const appName = settings.app_name || 'rosterchirp';
  const logoUrl = settings.logo_url;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          {logoUrl ? (
            <img src={logoUrl} alt={appName} className="logo-img" />
          ) : (
            <img src="/icons/rosterchirp.png" alt="rosterchirp" className="logo-img" />
          )}
          <h1>{appName}</h1>
          <p>Sign in to continue</p>
        </div>

        {settings.pw_reset_active === 'true' && (
          <div className="warning-banner" style={{ marginBottom: 16 }}>
            <span>⚠️</span>
            <span><strong>ADMPW_RESET is enabled.</strong> The admin password is being reset on each restart. Disable ADMPW_RESET in your environment to stop this behavior.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="your@email.com" autoComplete="email" autoCorrect="off" autoCapitalize="off" spellCheck="false" />
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" />
          </div>

          <label className="remember-me">
            <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
            <span>Remember me</span>
          </label>

          <button className="btn btn-primary w-full" type="submit" disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 18, height: 18 }} /> : 'Sign in'}
          </button>
        </form>

        <div className="login-footer">
          <button className="support-link" onClick={() => setShowSupport(true)}>
            Need help? Contact Support
          </button>
        </div>

        {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}
      </div>
    </div>
  );
}
