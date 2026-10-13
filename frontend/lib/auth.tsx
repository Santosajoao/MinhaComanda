'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken } from './api';

export interface Me {
  user: { id: string; name: string; email: string; role: string; establishmentId: string };
  establishment: any; cashSession: any;
}
interface AuthState {
  me: Me | null; loading: boolean; terminals: any[]; terminalId: string;
  setTerminal: (id: string) => void; refresh: () => Promise<void>; login: (email: string, password: string) => Promise<void>; logout: () => void;
}
const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [terminalId, setTid] = useState('');

  const refresh = useCallback(async () => {
    if (!getToken()) { setMe(null); setLoading(false); return; }
    try {
      setMe(await api('GET', '/auth/me'));
      const t = await api<any[]>('GET', '/terminals');
      setTerminals(t.filter((x) => x.active));
      const saved = localStorage.getItem('terminalId') ?? '';
      if (saved && !t.some((x) => x.id === saved && x.active)) { localStorage.removeItem('terminalId'); setTid(''); } else setTid(saved);
    } catch { setMe(null); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email: string, password: string) => {
    const r = await api('POST', '/auth/login', { email, password });
    localStorage.setItem('token', r.token);
    await refresh();
  };
  const logout = () => { localStorage.removeItem('token'); setMe(null); location.href = '/login'; };
  const setTerminal = (id: string) => { if (id) localStorage.setItem('terminalId', id); else localStorage.removeItem('terminalId'); setTid(id); };
  return <Ctx.Provider value={{ me, loading, terminals, terminalId, setTerminal, refresh, login, logout }}>{children}</Ctx.Provider>;
}
