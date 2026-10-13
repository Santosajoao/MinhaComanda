'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, useToast } from '@/components/ui';
import { api, dt, money, STATUS_LABEL } from '@/lib/api';

export default function Comandas() {
  const toast = useToast();
  const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => api('GET', `/tabs?limit=300${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setRows).catch(toast.err), [status, q]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  return (
    <Shell>
      <h1>Comandas</h1>
      <div className="card row">
        <label style={{ maxWidth: 240 }}>Situação<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.keys(STATUS_LABEL).filter((s) => ['aberta', 'em_conferencia', 'aguardando_pagamento', 'parcialmente_paga', 'paga', 'encerrada', 'bloqueada', 'cancelada'].includes(s)).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label>Buscar por número ou nome<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Nº</th><th>Consumidor</th><th>Situação</th><th>Abertura</th><th className="num">Consumo</th><th className="num">Total</th><th className="num">Pago</th><th className="num">Saldo</th><th /></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id}><td><b>{t.number}</b></td><td>{t.consumer?.name}</td><td><Badge status={t.status} /></td><td>{dt(t.opened_at)}</td>
              <td className="num">{money(t.totals.gross_cents)}</td><td className="num">{money(t.totals.net_cents)}</td><td className="num">{money(t.totals.paid_cents)}</td>
              <td className={`num ${t.totals.balance_cents ? 'pos' : ''}`}>{money(t.totals.balance_cents)}</td>
              <td><Link href={`/caixa?n=${t.number}`}>caixa</Link> · <Link href={`/extrato/${t.id}`}>extrato</Link></td></tr>))}</tbody></table>
        {!rows.length && <p className="muted">Nenhuma comanda encontrada.</p>}
      </div>
    </Shell>
  );
}
