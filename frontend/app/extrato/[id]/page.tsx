'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, useToast } from '@/components/ui';
import { api, dt, METHOD_LABEL, money } from '@/lib/api';

export default function Extrato() {
  const { id } = useParams<{ id: string }>(); const toast = useToast();
  const [st, setSt] = useState<any>(null);
  useEffect(() => { api('GET', `/tabs/${id}/statement`).then(setSt).catch(toast.err); }, [id]); // eslint-disable-line
  if (!st) return <Shell><p className="muted">Carregando extrato…</p></Shell>;
  const { tab, items, adjustments, payments, refunds } = st; const t = tab.totals;
  return (
    <Shell>
      <div className="row end no-print" style={{ maxWidth: 760, margin: '0 auto 10px' }}><button className="btn" onClick={() => window.print()}>Imprimir</button></div>
      <div className="stmt">
        <div className="row between"><div><h1 style={{ marginBottom: 0 }}>{tab.establishment_name}</h1><div className="muted">Extrato de comanda{tab.event_name ? ` · ${tab.event_name}` : ''}</div></div><div className="right"><div className="big">{tab.number}</div><Badge status={tab.status} /></div></div>
        <p>Consumidor: <b>{tab.consumer?.name}</b>{tab.consumer?.cpf_masked && ` · CPF ${tab.consumer.cpf_masked}`}<br />Abertura: {dt(tab.opened_at)} ({tab.opened_by_name}){tab.closed_at && <><br />Encerramento: {dt(tab.closed_at)} ({tab.closed_by_name})</>}</p>
        <table><thead><tr><th>Item</th><th className="num">Qtd</th><th className="num">Unit.</th><th className="num">Subtotal</th></tr></thead>
          <tbody>{items.map((i: any) => <tr key={i.id} className={i.status === 'cancelado' ? 'cancelled' : ''}><td>{i.description}{i.status === 'cancelado' ? ' (cancelado)' : ''}</td><td className="num">{i.quantity}</td><td className="num">{money(i.unit_price_cents)}</td><td className="num">{money(i.subtotal_cents)}</td></tr>)}</tbody></table>
        {adjustments.filter((a: any) => a.type === 'desconto').map((a: any) => <div key={a.id} className="row between" style={{ marginTop: 6 }}><span className={a.revoked_at ? 'muted' : ''}>Desconto{a.revoked_at ? ' (revertido)' : ''}: {a.reason}</span><span>− {money(a.amount_cents)}</span></div>)}
        <div className="totals" style={{ marginTop: 14 }}>
          <span>Total bruto</span><span className="right">{money(t.gross_cents)}</span><span>Descontos</span><span className="right">− {money(t.discount_cents)}</span>
          {t.fee_cents > 0 && <><span>Taxa de serviço</span><span className="right">{money(t.fee_cents)}</span></>}
          <span className="t">Total líquido</span><span className="t right">{money(t.net_cents)}</span>
        </div>
        <h2 style={{ marginTop: 18 }}>Pagamentos</h2>
        {!payments.length && <p className="muted">Nenhum pagamento.</p>}
        <table><tbody>{payments.map((p: any) => <tr key={p.id}><td>{METHOD_LABEL[p.method]}</td><td><Badge status={p.status} /></td><td className="muted">{p.reference ?? ''}</td><td className="num">{money(p.amount_cents)}</td></tr>)}</tbody></table>
        {refunds.length > 0 && <p className="muted">Estornos: {refunds.map((r: any) => `${money(r.amount_cents)} (${r.reason})`).join('; ')}</p>}
        <div className="totals" style={{ marginTop: 10 }}><span>Pago</span><span className="right">{money(t.paid_cents)}</span><span className="t">Saldo</span><span className="t right">{money(t.balance_cents)}</span></div>
        <p className="muted" style={{ marginTop: 20, fontSize: 12 }}>Emitido em {dt(st.generated_at)} por {st.generated_by}. O CPF não faz parte do cálculo da conta.</p>
      </div>
    </Shell>
  );
}
