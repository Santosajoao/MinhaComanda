'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Shell, { canSee } from '@/components/Shell';
import { useAuth } from '@/lib/auth';
import { api, money } from '@/lib/api';

const CARDS = [
  { href: '/recepcao', t: 'Recepção', d: 'Abrir comandas e cadastrar consumidores', roles: ['recepcao', 'caixa', 'supervisor', 'gerente', 'admin'] },
  { href: '/consumo', t: 'Consumo', d: 'Lançar produtos nas comandas', roles: ['atendente', 'caixa', 'supervisor', 'gerente', 'admin'] },
  { href: '/caixa', t: 'Caixa', d: 'Conferir, receber e encerrar comandas', roles: ['caixa', 'supervisor', 'gerente', 'admin'] },
  { href: '/comandas', t: 'Comandas', d: 'Consultar todas as comandas', roles: [] },
  { href: '/relatorios', t: 'Relatórios', d: 'Vendas, pagamentos, caixa e divergências', roles: ['gerente', 'admin', 'auditor', 'supervisor'] },
  { href: '/produtos', t: 'Produtos', d: 'Catálogo, preços e promoções', roles: ['gerente', 'admin'] },
];

export default function Home() {
  const { me } = useAuth();
  const [stats, setStats] = useState<any>(null);
  useEffect(() => { api('GET', '/tabs?limit=500').then((t: any[]) => setStats({
    open: t.filter((x) => ['aberta', 'em_conferencia', 'aguardando_pagamento', 'parcialmente_paga', 'paga', 'bloqueada'].includes(x.status)).length,
    balance: t.filter((x) => x.status !== 'encerrada' && x.status !== 'cancelada').reduce((s, x) => s + Math.max(0, x.totals.balance_cents), 0),
  })).catch(() => {}); }, []);
  return (
    <Shell>
      <h1>Olá, {me?.user.name}</h1>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="card"><div className="muted">Comandas ativas</div><div className="big">{stats?.open ?? '—'}</div></div>
        <div className="card"><div className="muted">A receber nas ativas</div><div className="big">{stats ? money(stats.balance) : '—'}</div></div>
      </div>
      <div className="grid g3">
        {CARDS.filter((c) => me && canSee(me.user.role, c.roles)).map((c) => (
          <Link key={c.href} href={c.href} className="card"><h2>{c.t}</h2><span className="muted">{c.d}</span></Link>
        ))}
      </div>
    </Shell>
  );
}
