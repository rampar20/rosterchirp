import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../utils/api.js';
import PasswordInput from '../components/PasswordInput.jsx';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const { setMustChangePassword } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) return toast('Passwords do not match', 'error');
    if (next.length < 8) return toast('Password must be at least 8 characters', 'error');
    setLoading(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setMustChangePassword(false);
      toast('Password changed!', 'success');
      nav('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={{ marginBottom: 8, fontSize: 22, fontWeight: 700 }}>Change Password</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
          You must set a new password before continuing.
        </p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="flex-col gap-1">
            <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Current Password</label>
            <PasswordInput value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="flex-col gap-1">
            <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>New Password</label>
            <PasswordInput value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required />
          </div>
          <div className="flex-col gap-1">
            <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Confirm New Password</label>
            <PasswordInput value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
