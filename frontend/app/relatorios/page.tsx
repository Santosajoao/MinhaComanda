'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { useToast } from '@/components/ui';
import { api, download, dt, METHOD_LABEL, money, STATUS_LABEL } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Relatorios() {
  const toast = useToast(); const { me } = useAuth();
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [ev, setEv] = useState(''); const [events, setEvents] = useState<any[]>([]);
  const [s, setS] = useState<any>(null); const [cash, setCash] = useState<any[]>([]);
  const qs = () => { const p = new URLSearchParams(); if (from) p.set('from', from); if (to) p.set('to', to); if (ev) p.set('event_id', ev); return p.toString(); };
  const load = useCallback(async () => {
    try { setS(await api('GET', `/reports/summary?${qs()}`)); setCash(await api('GET', `/reports/cash-closings?${qs()}`)); } catch (e) { toast.err(e); }
  }, [from, to, ev]); // eslint-disable-line
  useEffect(() => { api('GET', '/events').then(setEvents).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const max = s ? Math.max(1, ...s.sales_by_day.map((d: any) => d.total_cents)) : 1;
  const canExport = ['gerente', 'admin'].includes(me?.user.role ?? '');
  const exp = (type: string) => download(`/reports/export?type=${type}&${qs()}`, `${type}.csv`).catch(toast.err);
  return (
    <Shell roles={['gerente', 'admin', 'auditor', 'supervisor']}>
      <h1>Relatórios</h1>
      <div className="card row">
        <label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Evento<select value={ev} onChange={(e) => setEv(e.target.value)}><option value="">Todos</option>{events.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        {canExport && <div className="row" style={{ marginTop: 8 }}><button className="btn ghost sm" onClick={() => exp('tabs')}>CSV comandas</button><button className="btn ghost sm" onClick={() => exp('payments')}>CSV pagamentos</button><button className="btn ghost sm" onClick={() => exp('products')}>CSV produtos</button></div>}
      </div>
      {s && <>
        <p className="muted">Período: {s.period.from} a {s.period.to}</p>
        <div className="grid g3">
          <div className="card"><div className="muted">Vendas (consumo válido)</div><div className="big" style={{ fontSize: 26 }}>{money(s.totals.gross_sales_cents)}</div></div>
          <div className="card"><div className="muted">Recebido (confirmado)</div><div className="big" style={{ fontSize: 26 }}>{money(s.totals.received_cents)}</div></div>
          <div className="card"><div className="muted">Ticket médio ({s.totals.closed_tabs} comandas encerradas)</div><div className="big" style={{ fontSize: 26 }}>{money(s.totals.ticket_medio_cents)}</div></div>
          <div className="card"><div className="muted">Descontos ({s.totals.discounts.count})</div><div className="big" style={{ fontSize: 26 }}>{money(s.totals.discounts.total_cents)}</div></div>
          <div className="card"><div className="muted">Cancelamentos ({s.totals.cancellations.count})</div><div className="big" style={{ fontSize: 26 }}>{money(s.totals.cancellations.total_cents)}</div></div>
          <div className="card"><div className="muted">Estornos ({s.totals.refunds.count})</div><div className="big" style={{ fontSize: 26 }}>{money(s.totals.refunds.total_cents)}</div></div>
        </div>
        <div className="card"><h2>Vendas por dia</h2>{s.sales_by_day.map((d: any) => (
          <div key={d.day} className="row" style={{ marginBottom: 4 }}><span style={{ width: 90 }}>{new Date(d.day).toLocaleDateString('pt-BR')}</span><div style={{ flex: 1 }}><div className="bar" style={{ width: `${(d.total_cents / max) * 100}%` }} /></div><b style={{ width: 110, textAlign: 'right' }}>{money(d.total_cents)}</b></div>))}
          {!s.sales_by_day.length && <p className="muted">Sem vendas no período.</p>}</div>
        <div className="grid g2">
          <div className="card"><h2>Por produto</h2><table><thead><tr><th>Produto</th><th className="num">Qtd</th><th className="num">Total</th></tr></thead><tbody>{s.by_product.map((r: any) => <tr key={r.description}><td>{r.description}</td><td className="num">{r.quantity}</td><td className="num">{money(r.total_cents)}</td></tr>)}</tbody></table></div>
          <div>
            <div className="card"><h2>Por categoria</h2><table><tbody>{s.by_category.map((r: any) => <tr key={r.category}><td>{r.category}</td><td className="num">{r.quantity}</td><td className="num">{money(r.total_cents)}</td></tr>)}</tbody></table></div>
            <div className="card"><h2>Por ponto de venda</h2><table><tbody>{s.by_terminal.map((r: any) => <tr key={r.terminal}><td>{r.terminal}</td><td className="num">{r.lines} lanç.</td><td className="num">{money(r.total_cents)}</td></tr>)}</tbody></table></div>
          </div>
        </div>
        <div className="grid g2">
          <div className="card"><h2>Pagamentos por forma</h2><table><thead><tr><th>Forma</th><th>Situação</th><th className="num">Qtd</th><th className="num">Total</th></tr></thead><tbody>{s.payments_by_method.map((r: any, i: number) => <tr key={i}><td>{METHOD_LABEL[r.method]}</td><td>{STATUS_LABEL[r.status]}</td><td className="num">{r.count}</td><td className="num">{money(r.total_cents)}</td></tr>)}</tbody></table></div>
          <div className="card"><h2>Comandas por situação</h2><table><tbody>{s.tabs_by_status.map((r: any) => <tr key={r.status}><td>{STATUS_LABEL[r.status]}</td><td className="num">{r.count}</td></tr>)}</tbody></table></div>
        </div>
        <div className="card"><h2>Divergências entre consumo e pagamento (comandas encerradas com saldo ≠ 0)</h2>
          {!s.divergences.length ? <p className="neg">Nenhuma divergência.</p> : <table><thead><tr><th>Comanda</th><th className="num">Total</th><th className="num">Pago</th><th className="num">Saldo</th><th>Exceção</th></tr></thead><tbody>{s.divergences.map((d: any) => <tr key={d.id}><td>{d.number}</td><td className="num">{money(d.net_cents)}</td><td className="num">{money(d.paid_cents)}</td><td className="num pos">{money(d.balance_cents)}</td><td>{d.close_exception}</td></tr>)}</tbody></table>}</div>
        <div className="card"><h2>Reaberturas e exceções administrativas</h2>
          {!s.exceptions.length ? <p className="muted">Nenhuma.</p> : <table><tbody>{s.exceptions.map((d: any) => <tr key={d.id}><td>{d.number}</td><td>{STATUS_LABEL[d.status]}</td><td>{d.reopen_count ? `${d.reopen_count} reabertura(s)` : ''}</td><td>{d.close_exception ?? ''}</td></tr>)}</tbody></table>}</div>
        <div className="card" style={{ overflowX: 'auto' }}><h2>Fechamentos de caixa por operador e turno</h2>
          <table><thead><tr><th>Operador</th><th>Terminal</th><th>Abertura</th><th>Fechamento</th><th className="num">Troco inicial</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferença</th></tr></thead><tbody>{cash.map((c) => (
            <tr key={c.id}><td>{c.user_name}</td><td>{c.terminal_name ?? '—'}</td><td>{dt(c.opened_at)}</td><td>{c.status === 'aberto' ? 'em aberto' : dt(c.closed_at)}</td><td className="num">{money(c.opening_cents)}</td>
              <td className="num">{c.status === 'fechado' ? money(c.expected_cents) : '—'}</td><td className="num">{c.status === 'fechado' ? money(c.counted_cents) : '—'}</td><td className={`num ${c.difference_cents ? 'pos' : ''}`}>{c.status === 'fechado' ? money(c.difference_cents) : '—'}</td></tr>))}</tbody></table></div>
      </>}
    </Shell>
  );
}
