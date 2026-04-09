import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../utils/api.js';
import Avatar from './Avatar.jsx';

const LS_FONT_KEY = 'rosterchirp_font_scale';
const MIN_SCALE = 0.8;
const MAX_SCALE = 2.0;

export default function ProfileModal({ onClose }) {
  const { user, updateUser } = useAuth();
  const toast = useToast();

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [savedDisplayName, setSavedDisplayName] = useState(user?.display_name || '');
  const [displayNameWarning, setDisplayNameWarning] = useState('');
  const [aboutMe, setAboutMe] = useState(user?.about_me || '');
  const [dob, setDob] = useState(user?.date_of_birth ? user.date_of_birth.slice(0, 10) : '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('profile'); // 'profile' | 'password' | 'notifications' | 'appearance'
  const [pushTesting, setPushTesting] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const isIOS = /iphone|ipad/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isDesktop = !isIOS && !isAndroid;
  const isStandalone = window.navigator.standalone === true;
  const [hideAdminTag, setHideAdminTag] = useState(!!user?.hide_admin_tag);
  const [allowDm, setAllowDm] = useState(user?.allow_dm !== 0);

  // Minor age protection — DOB/phone display + mixed_age forced-DOB gate
  const [loginType, setLoginType] = useState('all_ages');
  // True when mixed_age mode and the user still has no DOB on record
  const needsDob = loginType === 'mixed_age' && !user?.date_of_birth;

  const savedScale = parseFloat(localStorage.getItem(LS_FONT_KEY));
  const [fontScale, setFontScale] = useState(
    (savedScale >= MIN_SCALE && savedScale <= MAX_SCALE) ? savedScale : 1.0
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load login type for DOB/phone field visibility
  useEffect(() => {
    api.getSettings().then(({ settings: s }) => {
      setLoginType(s.feature_login_type || 'all_ages');
    }).catch(() => {});
  }, []);

  const applyFontScale = (val) => {
    setFontScale(val);
    document.documentElement.style.setProperty('--font-scale', val);
    localStorage.setItem(LS_FONT_KEY, val);
  };

  const handleSaveProfile = async () => {
    if (displayNameWarning) return toast('Display name is already in use', 'error');
    setLoading(true);
    try {
      const { user: updated } = await api.updateProfile({ displayName, aboutMe, hideAdminTag, allowDm, dateOfBirth: dob || null, phone: phone || null });
      updateUser(updated);
      setSavedDisplayName(displayName);
      toast('Profile updated', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { avatarUrl } = await api.uploadAvatar(file);
      updateUser({ avatar: avatarUrl });
      toast('Avatar updated', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) return toast('Passwords do not match', 'error');
    if (newPw.length < 8) return toast('Password too short (min 8)', 'error');
    setLoading(true);
    try {
      await api.changePassword({ currentPassword: currentPw, newPassword: newPw });
      toast('Password changed', 'success');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Forced DOB gate for mixed_age users ───────────────────────────────────
  if (needsDob) {
    return (
      <div className="modal-overlay">
        <div className="modal" style={{ maxWidth: 380 }}>
          <h2 className="modal-title" style={{ marginBottom: 8 }}>Date of Birth Required</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            Your organisation requires a date of birth on file. Please enter yours to continue.
          </p>
          <div className="flex-col gap-1" style={{ marginBottom: 16 }}>
            <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Date of Birth <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              className="input"
              type="text"
              placeholder="YYYY-MM-DD"
              value={dob}
              onChange={e => setDob(e.target.value)}
              autoComplete="off"
              style={{ borderColor: dob ? undefined : 'var(--error)' }}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading || !dob.trim()}
            onClick={async () => {
              if (!dob.trim()) return;
              setLoading(true);
              try {
                const { user: updated } = await api.updateProfile({ displayName, aboutMe, hideAdminTag, allowDm, dateOfBirth: dob.trim(), phone: phone || null });
                updateUser(updated);
                toast('Profile updated', 'success');
                // needsDob will re-evaluate to false now that user.date_of_birth is set
              } catch (e) {
                toast(e.message, 'error');
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? 'Saving…' : 'Save & Continue'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>My Profile</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Avatar */}
        <div className="flex items-center gap-3" style={{ gap: 16, marginBottom: 20 }}>
          <div style={{ position: 'relative' }}>
            <Avatar user={user} size="xl" />
            {!user?.is_default_admin && (
              <label title="Change avatar" style={{
                position: 'absolute', bottom: 0, right: 0,
                background: 'var(--primary)', color: 'white', borderRadius: '50%',
                width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 12
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <input type="file" accept="image/*"
                  style={{ opacity: 0, position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }}
                  onChange={handleAvatarUpload} />
              </label>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{user?.display_name || user?.name}</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{user?.email}</div>
            <span className={`role-badge role-${user?.role}`}>{user?.role}</span>
          </div>
        </div>

        {/* Tab navigation — unified select list on all screen sizes */}
        <div style={{ marginBottom: 20 }}>
          <label className="text-sm" style={{ color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>SELECT OPTION:</label>
          <select className="input" value={tab} onChange={e => { setTab(e.target.value); setPushResult(null); }}>
            <option value="profile">Profile</option>
            <option value="password">Change Password</option>
            <option value="notifications">Notifications</option>
            <option value="appearance">Appearance</option>
          </select>
        </div>

        {tab === 'profile' && (
          <div className="flex-col gap-3">
            <div className="flex-col gap-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Display Name</label>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  value={displayName}
                  onChange={async e => {
                    const val = e.target.value;
                    setDisplayName(val);
                    setDisplayNameWarning('');
                    if (val && val !== user?.display_name) {
                      try {
                        const { taken } = await api.checkDisplayName(val);
                        if (taken) setDisplayNameWarning('Display name is already in use');
                      } catch {}
                    }
                  }}
                  placeholder={user?.name}
                  autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                  style={{ borderColor: displayNameWarning ? '#e53935' : undefined }} />
                {displayName !== savedDisplayName ? null : savedDisplayName ? (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'var(--surface-variant)', color: 'var(--text-secondary)', flexShrink: 0 }}
                    onClick={() => setDisplayName('')}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {displayNameWarning && <span className="text-xs" style={{ color: '#e53935' }}>{displayNameWarning}</span>}
              {savedDisplayName && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Username: {user?.name}</span>}
            </div>
            <div className="flex-col gap-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>About Me</label>
              <textarea className="input" value={aboutMe} onChange={e => setAboutMe(e.target.value)} placeholder="Tell your team about yourself..." rows={3} autoComplete="off" autoCorrect="off" spellCheck={false} style={{ resize: 'vertical' }} />
            </div>
            {user?.role === 'admin' && (
              <label className="flex items-center gap-2 text-sm pointer" style={{ color: 'var(--text-secondary)', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={hideAdminTag}
                  onChange={e => setHideAdminTag(e.target.checked)}
                  style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
                Hide "Admin" tag next to my name in messages
              </label>
            )}
            <label className="flex items-center gap-2 text-sm pointer" style={{ color: 'var(--text-secondary)', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={allowDm}
                onChange={e => setAllowDm(e.target.checked)}
                style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
              Allow others to send me direct messages
            </label>
            {/* Date of Birth + Phone — visible in Guardian Only / Mixed Age modes */}
            {loginType !== 'all_ages' && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                <div className="flex-col gap-1">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Date of Birth</label>
                  <input className="input" type="text" placeholder="YYYY-MM-DD" value={dob} onChange={e => setDob(e.target.value)} autoComplete="off" />
                </div>
                <div className="flex-col gap-1">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Phone</label>
                  <input className="input" type="tel" placeholder="+1 555 000 0000" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
                </div>
              </div>
            )}
            <button className="btn btn-primary" onClick={handleSaveProfile} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="flex-col gap-3">
            {isDesktop ? (
              <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface-variant)', border: '1px solid var(--border)', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                In-app notifications are active on this device. Unread message counts and browser tab indicators update in real time — no additional setup needed.
              </div>
            ) : isIOS && !isStandalone ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 8, background: 'var(--surface-variant)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Home Screen required for notifications</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Push notifications on iPhone require RosterChirp to be installed as an app. To do this:
                  <ol style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <li>Tap the <strong>Share</strong> button (<svg style={{ display: 'inline', verticalAlign: 'middle', margin: '0 2px' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>) at the bottom of Safari</li>
                    <li>Select <strong>"Add to Home Screen"</strong></li>
                    <li>Tap <strong>Add</strong>, then open RosterChirp from your Home Screen</li>
                    <li>Go to <strong>Profile → Notifications</strong> to enable push notifications</li>
                  </ol>
                </div>
              </div>
            ) : (
              <>
            {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--surface-variant)' }}>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  {notifPermission === 'denied'
                    ? isIOS
                      ? 'Notifications are blocked. Enable them in iOS Settings → RosterChirp → Notifications.'
                      : 'Notifications are blocked. Enable them in Android Settings → Apps → RosterChirp → Notifications.'
                    : 'Push notifications are not yet enabled on this device.'}
                </div>
                {notifPermission === 'default' && (
                  <button className="btn btn-primary btn-sm" onClick={async () => {
                    const result = await Notification.requestPermission();
                    setNotifPermission(result);
                    if (result === 'granted') window.dispatchEvent(new CustomEvent('rosterchirp:push-init'));
                  }}>Enable Notifications</button>
                )}
              </div>
            )}
            {notifPermission === 'granted' && (
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <p style={{ margin: '0 0 8px' }}>Tap <strong>Send Test Notification</strong> to trigger a push to this device. The notification will arrive shortly if everything is configured correctly.</p>
                <p style={{ margin: 0 }}>If it doesn't arrive, check:<br/>
                  {isIOS ? (
                    <>• iOS Settings → RosterChirp → Notifications → Allow<br/>
                    • App must be added to the Home Screen (not open in Safari)<br/></>
                  ) : (
                    <>• Android Settings → Apps → RosterChirp → Notifications → Enabled<br/></>
                  )}
                  • App is backgrounded when the test fires
                </p>
              </div>
            )}
            {notifPermission === 'granted' && (<>
              <div className="flex gap-2">
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={pushTesting}
                  onClick={async () => {
                    setPushTesting(true);
                    setPushResult(null);
                    try {
                      const { results } = await api.testPush('data');
                      setPushResult({ ok: true, results, mode: 'data' });
                    } catch (e) {
                      setPushResult({ ok: false, error: e.message });
                    } finally {
                      setPushTesting(false);
                    }
                  }}
                >
                  {pushTesting ? 'Sending…' : 'Test (via SW)'}
                </button>
                {!isIOS && (
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    disabled={pushTesting}
                    onClick={async () => {
                      setPushTesting(true);
                      setPushResult(null);
                      try {
                        const { results } = await api.testPush('browser');
                        setPushResult({ ok: true, results, mode: 'browser' });
                      } catch (e) {
                        setPushResult({ ok: false, error: e.message });
                      } finally {
                        setPushTesting(false);
                      }
                    }}
                  >
                    {pushTesting ? 'Sending…' : 'Test (via Browser)'}
                  </button>
                )}
              </div>
              {!isIOS && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                  <strong>Test (via SW)</strong> — normal production path, service worker shows notification.<br/>
                  <strong>Test (via Browser)</strong> — bypasses service worker; Chrome displays directly.
                </div>
              )}
            </>)}
            {pushResult && (
              <div style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: pushResult.ok ? 'var(--surface-variant)' : '#fdecea',
                color: pushResult.ok ? 'var(--text-primary)' : '#c62828',
                fontSize: 13,
              }}>
                {pushResult.ok ? (
                  pushResult.results.map((r, i) => (
                    <div key={i}>
                      <strong>{r.device}</strong>: {r.status === 'sent' ? '✓ Sent — check your device for the notification' : `✗ Failed — ${r.error}`}
                    </div>
                  ))
                ) : (
                  <div>✗ {pushResult.error}</div>
                )}
              </div>
            )}
              </>
            )}
          </div>
        )}

        {tab === 'password' && (
          <div className="flex-col gap-3">
            <div className="flex-col gap-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Current Password</label>
              <input className="input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="flex-col gap-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>New Password</label>
              <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="flex-col gap-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Confirm New Password</label>
              <input className="input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} autoComplete="new-password" />
            </div>
            <button className="btn btn-primary" onClick={handleChangePassword} disabled={loading || !currentPw || !newPw}>
              {loading ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="flex-col gap-3">
            <div className="flex-col gap-2">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Message Font Size</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>A</span>
                <input
                  type="range"
                  min={MIN_SCALE}
                  max={MAX_SCALE}
                  step={0.05}
                  value={fontScale}
                  onChange={e => applyFontScale(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--primary)' }}
                />
                <span style={{ fontSize: 18, color: 'var(--text-tertiary)', flexShrink: 0 }}>A</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 40, textAlign: 'right', flexShrink: 0 }}>
                  {Math.round(fontScale * 100)}%
                </span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Pinch to zoom adjusts font size for this session only.
              </span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => applyFontScale(1.0)}
            >
              Reset to Default
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
