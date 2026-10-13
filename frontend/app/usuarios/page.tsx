'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { usePrompt, useToast } from '@/components/ui';
import { api, ROLE_LABEL } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Usuarios() {
  const toast = useToast(); const prompt = usePrompt(); const { me } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [f, setF] = useState({ name: '', email: '', password: '', role: 'atendente' });
  const load = useCallback(() => api('GET', '/users').then(setRows).catch(toast.err), []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  const roles = Object.keys(ROLE_LABEL).filter((r) => me?.user.role === 'admin' || r !== 'admin');
  const create = async () => { try { await api('POST', '/users', f); toast.ok('Usuário criado'); setF({ name: '', email: '', password: '', role: 'atendente' }); load(); } catch (e) { toast.err(e); } };
  const patch = async (id: string, body: any, ok: string) => { try { await api('PATCH', `/users/${id}`, body); toast.ok(ok); load(); } catch (e) { toast.err(e); } };
  return (
    <Shell roles={['gerente', 'admin']}>
      <h1>Usuários</h1>
      <div className="card"><h2>Novo usuário</h2>
        <div className="row"><label>Nome<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label>E-mail<input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label>Senha inicial (mín. 8)<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          <label>Perfil<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label></div>
        <button className="btn" onClick={create}>Criar usuário</button></div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Ativo</th><th /></tr></thead><tbody>{rows.map((u) => (
          <tr key={u.id}><td>{u.name}</td><td>{u.email}</td>
            <td><select value={u.role} disabled={u.id === me?.user.id} onChange={(e) => patch(u.id, { role: e.target.value }, 'Perfil alterado')}>{roles.concat(roles.includes(u.role) ? [] : [u.role]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
            <td>{u.active ? 'sim' : 'não'}</td>
            <td><button className="btn ghost sm" disabled={u.id === me?.user.id} onClick={() => patch(u.id, { active: !u.active }, u.active ? 'Usuário desativado' : 'Usuário ativado')}>{u.active ? 'desativar' : 'ativar'}</button>{' '}
              <button className="btn ghost sm" onClick={async () => { try { const p = await prompt.prompt(`Nova senha para ${u.name}`, 'Nova senha (mín. 8 caracteres)'); await patch(u.id, { password: p }, 'Senha redefinida'); } catch { /* cancelado */ } }}>redefinir senha</button></td></tr>))}</tbody></table>
      </div>
      {prompt.dialog}
    </Shell>
  );
}
