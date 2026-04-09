import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    const token = localStorage.getItem('tc_token') || sessionStorage.getItem('tc_token');
    const socket = io('/', {
      auth: { token },
      transports: ['websocket'],
      // Aggressive reconnection so mobile resume is fast
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 8000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('users:online');
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('users:online', ({ userIds }) => setOnlineUsers(new Set(userIds)));
    socket.on('user:online', ({ userId }) => setOnlineUsers(prev => new Set([...prev, userId])));
    socket.on('user:offline', ({ userId }) => setOnlineUsers(prev => { const s = new Set(prev); s.delete(userId); return s; }));

    // Session displaced: another login on the same device type has kicked this session
    socket.on('session:displaced', () => {
      window.dispatchEvent(new CustomEvent('rosterchirp:session-displaced'));
    });

    // When app returns to foreground, force a full disconnect+reconnect.
    // The underlying WebSocket is often silently dead after Android background
    // suspension while socket.io-client still reports connected (stale state
    // until the ping/pong timeout fires ~45s later). Always force a fresh
    // connection so the "offline" indicator clears immediately on focus.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected, onlineUsers }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
