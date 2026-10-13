'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui';

const DEMO = process.env.NEXT_PUBLIC_DEMO_LOGINS === 'true';
const ROLES = ['admin', 'gerente', 'recepcao', 'atendente', 'caixa', 'supervisor', 'auditor'];

export default function LoginPage() {
  const { login } = useAuth(); const router = useRouter(); const toast = useToast();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await login(email, password); router.replace('/'); } catch (err) { toast.err(err); } finally { setBusy(false); }
  };
  return (
    <div className="login card">
      <h1>Comandas</h1>
      <p className="muted">Entre com seu usuário individual.</p>
      <form onSubmit={submit}>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      {DEMO && (
        <div className="demo" style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12 }}>Contas de teste (senha Senha@123) — clique para preencher:</div>
          {ROLES.map((r) => <button key={r} className="btn ghost sm" type="button" onClick={() => { setEmail(`${r}@exemplo.com`); setPassword('Senha@123'); }}>{r}</button>)}
        </div>
      )}
    </div>
  );
}
