'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/api';

const NAV: { href: string; label: string; roles: string[] }[] = [
  { href: '/', label: 'Início', roles: [] },
  { href: '/recepcao', label: 'Recepção', roles: ['recepcao', 'caixa', 'supervisor', 'gerente', 'admin'] },
  { href: '/consumo', label: 'Consumo', roles: ['atendente', 'caixa', 'supervisor', 'gerente', 'admin'] },
  { href: '/caixa', label: 'Caixa', roles: ['caixa', 'supervisor', 'gerente', 'admin'] },
  { href: '/comandas', label: 'Comandas', roles: [] },
  { href: '/produtos', label: 'Produtos', roles: ['gerente', 'admin'] },
  { href: '/relatorios', label: 'Relatórios', roles: ['gerente', 'admin', 'auditor', 'supervisor'] },
  { href: '/auditoria', label: 'Auditoria', roles: ['gerente', 'admin', 'auditor'] },
  { href: '/usuarios', label: 'Usuários', roles: ['gerente', 'admin'] },
  { href: '/config', label: 'Configurações', roles: ['gerente', 'admin'] },
];
export const canSee = (role: string, roles: string[]) => roles.length === 0 || roles.includes(role);

export default function Shell({ children, roles = [] }: { children: ReactNode; roles?: string[] }) {
  const { me, loading, terminals, terminalId, setTerminal, logout } = useAuth();
  const router = useRouter(); const path = usePathname();
  useEffect(() => { if (!loading && !me) router.replace('/login'); }, [loading, me, router]);
  if (loading || !me) return <div className="center muted">Carregando…</div>;
  const role = me.user.role;
  return (
    <>
      <header className="topbar no-print">
        <strong className="brand">{me.establishment.name}</strong>
        <nav>{NAV.filter((n) => canSee(role, n.roles)).map((n) => (
          <Link key={n.href} href={n.href} className={path === n.href ? 'active' : ''}>{n.label}</Link>
        ))}</nav>
        <div className="spacer" />
        <select value={terminalId} onChange={(e) => setTerminal(e.target.value)} title="Ponto de venda / terminal deste dispositivo">
          <option value="">Terminal: nenhum</option>
          {terminals.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="who">{me.user.name} · {ROLE_LABEL[role]}</span>
        <button className="btn ghost sm" onClick={logout}>Sair</button>
      </header>
      <main className="page">
        {!canSee(role, roles) ? <div className="card">Seu perfil não tem acesso a esta tela.</div> : children}
      </main>
    </>
  );
}
