'use client';
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { ApiError, STATUS_LABEL } from '@/lib/api';

const ToastCtx = createContext<{ ok: (m: string) => void; err: (e: unknown) => void }>({ ok: () => {}, err: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; kind: 'ok' | 'err'; msg: string }[]>([]);
  const push = useCallback((kind: 'ok' | 'err', msg: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, msg }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  const value = {
    ok: (m: string) => push('ok', m),
    err: (e: unknown) => push('err', e instanceof Error ? e.message : String(e)),
  };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts no-print">{items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="overlay no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal"><h3>{title}</h3>{children}</div>
    </div>
  );
}

export const Badge = ({ status }: { status: string }) => <span className={`badge b-${status}`}>{STATUS_LABEL[status] ?? status}</span>;

type Creds = { email: string; password: string };
/** Quando a operação exige autorização de supervisor/gerente, pede as credenciais e repete a chamada. */
export function useApproval() {
  const [ask, setAsk] = useState<null | { message: string; resolve: (c: Creds) => void; reject: () => void }>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const run = async <T,>(fn: (approval?: Creds) => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApiError && (e.code === 'APROVACAO_NECESSARIA' || e.code === 'DESCONTO_ACIMA_DO_LIMITE')) {
        const creds = await new Promise<Creds>((resolve, reject) => setAsk({ message: e.message, resolve, reject: () => reject(new Error('Autorização cancelada')) }));
        return await fn(creds);
      }
      throw e;
    }
  };
  const dialog = ask && (
    <Modal title="Autorização necessária" onClose={() => { ask.reject(); setAsk(null); }}>
      <p className="muted">{ask.message}</p>
      <p className="muted">Peça a um supervisor ou gerente para informar as credenciais:</p>
      <label>E-mail do autorizador<input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
      <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <div className="row end">
        <button className="btn ghost" onClick={() => { ask.reject(); setAsk(null); }}>Cancelar</button>
        <button className="btn" onClick={() => { const a = ask; setAsk(null); a.resolve({ email, password }); setPassword(''); }}>Autorizar</button>
      </div>
    </Modal>
  );
  return { run, dialog };
}

/** Pede um texto (ex.: motivo) em um modal. */
export function usePrompt() {
  const [st, setSt] = useState<null | { title: string; label: string; resolve: (v: string) => void; reject: () => void }>(null);
  const [val, setVal] = useState('');
  const prompt = (title: string, label = 'Motivo') => new Promise<string>((resolve, reject) => { setVal(''); setSt({ title, label, resolve, reject: () => reject(new Error('Cancelado')) }); });
  const dialog = st && (
    <Modal title={st.title} onClose={() => { st.reject(); setSt(null); }}>
      <label>{st.label}<input value={val} onChange={(e) => setVal(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && val.trim().length >= 3) { const s = st; setSt(null); s.resolve(val.trim()); } }} /></label>
      <div className="row end">
        <button className="btn ghost" onClick={() => { st.reject(); setSt(null); }}>Cancelar</button>
        <button className="btn" disabled={val.trim().length < 3} onClick={() => { const s = st; setSt(null); s.resolve(val.trim()); }}>Confirmar</button>
      </div>
    </Modal>
  );
  return { prompt, dialog };
}
