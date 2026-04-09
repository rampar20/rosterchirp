import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../utils/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('tc_token') || sessionStorage.getItem('tc_token');
    if (token) {
      api.me()
        .then(({ user }) => {
          setUser(user);
          setMustChangePassword(!!user.must_change_password);
        })
        .catch(() => {
          localStorage.removeItem('tc_token');
          sessionStorage.removeItem('tc_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password, rememberMe) => {
    const data = await api.login({ email, password, rememberMe });
    if (rememberMe) {
      localStorage.setItem('tc_token', data.token);
    } else {
      sessionStorage.setItem('tc_token', data.token);
    }
    setUser(data.user);
    setMustChangePassword(!!data.mustChangePassword);
    return data;
  };

  const logout = async () => {
    try { await api.logout(); } catch {}
    localStorage.removeItem('tc_token');
    sessionStorage.removeItem('tc_token');
    localStorage.removeItem('rc_fcm_token');
    setUser(null);
    setMustChangePassword(false);
  };

  // Listen for session displacement (another device logged in)
  useEffect(() => {
    const handler = () => {
      setUser(null);
      setMustChangePassword(false);
    };
    window.addEventListener('rosterchirp:session-displaced', handler);
    return () => window.removeEventListener('rosterchirp:session-displaced', handler);
  }, []);

  const updateUser = (updates) => setUser(prev => ({ ...prev, ...updates }));

  return (
    <AuthContext.Provider value={{ user, loading, mustChangePassword, setMustChangePassword, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
