'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, Modal, useApproval, usePrompt, useToast } from '@/components/ui';
import { api, ApiError, dt, METHOD_LABEL, money, newKey, parseMoney } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const CANCELLED_MSGS = ['Cancelado', 'Autorização cancelada'];

export default function Caixa() {
  const toast = useToast(); const approval = useApproval(); const prompt = usePrompt(); const { me } = useAuth();
  const role = me?.user.role ?? '';
  const [num, setNum] = useState(''); const [st, setSt] = useState<any>(null); const [cash, setCash] = useState<any>(undefined);
  const [opening, setOpening] = useState('100,00'); const [closing, setClosing] = useState(false); const [counted, setCounted] = useState(''); const [cashResult, setCashResult] = useState<any>(null);
  const [method, setMethod] = useState('pix'); const [amount, setAmount] = useState(''); const [ref, setRef] = useState(''); const [received, setReceived] = useState(''); const [pending, setPending] = useState(false);
  const [dType, setDType] = useState('valor'); const [dVal, setDVal] = useState(''); const [dReason, setDReason] = useState('');
  const payKey = useRef<string | null>(null); const [lastChange, setLastChange] = useState<number | null>(null);

  const loadCash = useCallback(() => api('GET', '/cash-register/current').then(setCash).catch((e) => { setCash(null); toast.err(e); }), []); // eslint-disable-line
  const load = useCallback(async (key: string) => {
    const s = await api('GET', `/tabs/${encodeURIComponent(key)}/statement`);
    setSt(s); const t = s.tab.totals; setAmount(((Math.max(0, t.balance_cents - t.pending_cents)) / 100).toFixed(2).replace('.', ','));
    return s;
  }, []);
  useEffect(() => { loadCash(); const n = new URLSearchParams(location.search).get('n'); if (n) { setNum(n); load(n).catch(toast.err); } }, []); // eslint-disable-line

  const search = async () => { try { setLastChange(null); await load(num); } catch (e) { setSt(null); toast.err(e); } };
  const tab = st?.tab; const tot = tab?.totals;
  const act = async (fn: () => Promise<any>, ok?: string) => {
    try { await fn(); if (ok) toast.ok(ok); if (tab) await load(tab.id); await loadCash(); }
    catch (e) { if (!CANCELLED_MSGS.includes((e as Error).message)) toast.err(e); }
  };

  const openCash = () => act(async () => { const v = parseMoney(opening); if (isNaN(v) || v < 0) throw new Error('Valor inválido'); setCash(await api('POST', '/cash-register/open', { opening_cents: v })); }, 'Caixa aberto');
  const closeCash = () => act(async () => {
    const v = parseMoney(counted); if (isNaN(v) || v < 0) throw new Error('Informe o valor contado em dinheiro');
    const r = await api('POST', '/cash-register/close', { counted_cents: v }); setCashResult(r); setClosing(false); setCash(null);
  });
  const pay = () => act(async () => {
    const v = parseMoney(amount); if (isNaN(v) || v <= 0) throw new Error('Valor do pagamento inválido');
    payKey.current ||= newKey();
    const body: any = { method, amount_cents: v, reference: ref || undefined };
    if (method === 'dinheiro' && received) body.cash_received_cents = parseMoney(received);
    if (method !== 'dinheiro' && pending) body.status = 'pendente';
    try {
      const r = await api('POST', `/tabs/${tab.id}/payments`, body, { key: payKey.current });
      payKey.current = null; setRef(''); setReceived(''); setPending(false); setLastChange(r.change_cents || null);
    } catch (e) { if (!(e instanceof ApiError && e.status === 0)) payKey.current = null; throw e; }
  }, 'Pagamento registrado');
  const payAction = (id: string, a: 'confirm' | 'reject' | 'cancel') => act(async () => {
    const body: any = {};
    if (a === 'confirm') { const r = await prompt.prompt('Confirmar pagamento', 'Referência da transação (NSU / ID Pix)'); body.reference = r; }
    else body.reason = await prompt.prompt(a === 'reject' ? 'Recusar pagamento' : 'Cancelar pagamento');
    await api('POST', `/payments/${id}/${a}`, body);
  }, 'Pagamento atualizado');
  const refund = (id: string) => act(async () => {
    const reason = await prompt.prompt('Estornar pagamento (exige gerente)', 'Motivo do estorno');
    await approval.run((a) => api('POST', `/payments/${id}/refunds`, { reason, approval: a }));
  }, 'Pagamento estornado');
  const discount = () => act(async () => {
    const v = dType === 'valor' ? parseMoney(dVal) : parseFloat(dVal.replace(',', '.'));
    if (!v || isNaN(v) || v <= 0) throw new Error('Informe o desconto');
    const body: any = { type: 'desconto', reason: dReason };
    if (dType === 'valor') body.amount_cents = v; else body.percent = v;
    await approval.run((a) => api('POST', `/tabs/${tab.id}/adjustments`, { ...body, approval: a }));
    setDVal(''); setDReason('');
  }, 'Desconto aplicado');
  const cancelItem = (it: any) => act(async () => {
    const reason = await prompt.prompt(`Cancelar "${it.description}"`, 'Motivo do cancelamento');
    await approval.run((a) => api('POST', `/tabs/${tab.id}/adjustments`, { type: 'cancelamento', item_id: it.id, reason, approval: a }));
  }, 'Item cancelado');
  const revoke = (adj: any) => act(async () => {
    const reason = await prompt.prompt('Reverter desconto', 'Motivo');
    await approval.run((a) => api('POST', `/tabs/${tab.id}/adjustments/${adj.id}/revoke`, { reason, approval: a }));
  }, 'Desconto revertido');
  const post = (path: string, ok: string, body?: any) => act(async () => { await api('POST', `/tabs/${tab.id}/${path}`, body ?? {}); }, ok);
  const close = () => act(async () => {
    try { await api('POST', `/tabs/${tab.id}/close`, {}); toast.ok('Comanda encerrada'); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'SALDO_PENDENTE' && confirm(`${e.message}\n\nEncerrar com EXCEÇÃO ADMINISTRATIVA? (exige gerente/administrador e fica auditado)`)) {
        const reason = await prompt.prompt('Exceção administrativa', 'Motivo (ex.: comanda perdida)');
        await approval.run((a) => api('POST', `/tabs/${tab.id}/close`, { exception: { reason }, approval: a }));
        toast.ok('Comanda encerrada por exceção');
      } else throw e;
    }
  });
  const reopen = () => act(async () => {
    const reason = await prompt.prompt('Reabrir comanda', 'Motivo da reabertura');
    await approval.run((a) => api('POST', `/tabs/${tab.id}/reopen`, { reason, approval: a }));
  }, 'Comanda reaberta');
  const block = (b: boolean) => act(async () => { const reason = await prompt.prompt(b ? 'Bloquear comanda' : 'Desbloquear comanda'); await api('POST', `/tabs/${tab.id}/${b ? 'block' : 'unblock'}`, { reason }); }, b ? 'Comanda bloqueada' : 'Comanda desbloqueada');
  const cancelTab = () => act(async () => {
    const reason = await prompt.prompt('Cancelar abertura da comanda', 'Motivo');
    await approval.run((a) => api('POST', `/tabs/${tab.id}/cancel`, { reason, approval: a }));
  }, 'Abertura cancelada');

  const payable = tab && ['em_conferencia', 'aguardando_pagamento', 'parcialmente_paga'].includes(tab.status);
  const editable = tab && ['aberta', 'em_conferencia', 'aguardando_pagamento', 'parcialmente_paga'].includes(tab.status);
  const supervisorUp = ['supervisor', 'gerente', 'admin'].includes(role);

  return (
    <Shell roles={['caixa', 'supervisor', 'gerente', 'admin']}>
      <h1>Caixa — conferência e pagamento</h1>
      <div className="card">
        {cash === undefined ? <span className="muted">Carregando caixa…</span> : cash ? (
          <div className="row between">
            <div><b>Caixa aberto</b> desde {dt(cash.opened_at)} · troco inicial {money(cash.opening_cents)} · dinheiro esperado em caixa <b>{money(cash.expected_cash_cents)}</b>
              <div className="muted">{cash.by_method.map((m: any) => `${METHOD_LABEL[m.method]}: ${money(m.total_cents)} (${m.count})`).join(' · ') || 'Nenhum recebimento ainda'}{cash.pending_payments ? ` · ${cash.pending_payments} pendente(s)` : ''}</div></div>
            <button className="btn warn" onClick={() => { setCounted(''); setClosing(true); }}>Fechar caixa</button>
          </div>
        ) : (
          <div className="row"><b>Seu caixa está fechado.</b><label style={{ maxWidth: 180, marginBottom: 0 }}>Troco inicial (R$)<input value={opening} onChange={(e) => setOpening(e.target.value)} /></label><button className="btn" onClick={openCash}>Abrir caixa</button></div>
        )}
        {cashResult && (
          <div style={{ marginTop: 10 }} className="muted">Último fechamento: esperado {money(cashResult.expected_cash_cents)} · contado {money(cashResult.counted_cents)} · diferença{' '}
            <b className={cashResult.difference_cents ? 'pos' : 'neg'}>{money(cashResult.difference_cents)}</b></div>
        )}
      </div>

      <div className="card row">
        <label style={{ maxWidth: 220 }}>Número da comanda<input value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} inputMode="numeric" placeholder="00428" autoFocus /></label>
        <button className="btn" style={{ marginTop: 8 }} onClick={search}>Buscar</button>
      </div>

      {tab && (
        <div className="split">
          <div>
            <div className="card">
              <div className="row between"><div><span className="big">{tab.number}</span> <Badge status={tab.status} /></div>
                <div className="right">{tab.consumer?.name}<div className="muted">{tab.consumer?.cpf_masked ? `CPF ${tab.consumer.cpf_masked} · ` : ''}aberta {dt(tab.opened_at)}</div></div></div>
              {tab.close_exception && <p className="pos">Encerrada por exceção: {tab.close_exception}</p>}
              <table style={{ marginTop: 10 }}>
                <thead><tr><th>Item</th><th className="num">Qtd</th><th className="num">Unit.</th><th className="num">Subtotal</th><th>Lançado por</th><th /></tr></thead>
                <tbody>{st.items.map((i: any) => (
                  <tr key={i.id} className={i.status === 'cancelado' ? 'cancelled' : ''}>
                    <td>{i.description}</td><td className="num">{i.quantity}</td><td className="num">{money(i.unit_price_cents)}</td><td className="num">{money(i.subtotal_cents)}</td>
                    <td className="keep muted">{i.created_by_name}{i.terminal_name ? ` · ${i.terminal_name}` : ''}<br />{dt(i.created_at)}</td>
                    <td className="keep">{i.status === 'valido' && editable && <button className="btn ghost sm" onClick={() => cancelItem(i)}>cancelar</button>}</td>
                  </tr>))}</tbody>
              </table>
              {!st.items.length && <p className="muted">Nenhum item lançado.</p>}
            </div>

            {st.adjustments.length > 0 && (
              <div className="card"><h2>Ajustes</h2><table><tbody>{st.adjustments.map((a: any) => (
                <tr key={a.id} className={a.revoked_at ? 'cancelled' : ''}><td>{a.type === 'desconto' ? 'Desconto' : `Cancelamento: ${a.item_description}`}</td><td className="num">{money(a.amount_cents)}</td>
                  <td className="keep muted">{a.reason} · {a.created_by_name}{a.approved_by_name && a.approved_by_name !== a.created_by_name ? ` (aprovado por ${a.approved_by_name})` : ''}</td>
                  <td className="keep">{a.type === 'desconto' && !a.revoked_at && editable && <button className="btn ghost sm" onClick={() => revoke(a)}>reverter</button>}</td></tr>))}</tbody></table></div>
            )}

            <div className="card">
              <h2>Pagamentos</h2>
              {!st.payments.length && <p className="muted">Nenhum pagamento registrado.</p>}
              <table><tbody>{st.payments.map((p: any) => (
                <tr key={p.id}><td>{METHOD_LABEL[p.method]}</td><td className="num">{money(p.amount_cents)}</td><td><Badge status={p.status} /></td>
                  <td className="muted keep">{p.reference ?? ''} {p.status_reason ? `· ${p.status_reason}` : ''}<br />{p.created_by_name} · {dt(p.created_at)}</td>
                  <td className="keep">
                    {p.status === 'pendente' && <div className="row"><button className="btn ok sm" onClick={() => payAction(p.id, 'confirm')}>confirmar</button><button className="btn bad sm" onClick={() => payAction(p.id, 'reject')}>recusar</button><button className="btn ghost sm" onClick={() => payAction(p.id, 'cancel')}>cancelar</button></div>}
                    {p.status === 'confirmado' && tab.status !== 'encerrada' && <button className="btn ghost sm" onClick={() => refund(p.id)}>estornar</button>}
                  </td></tr>))}</tbody></table>
            </div>
          </div>

          <div>
            <div className="card">
              <div className="totals">
                <span>Consumo</span><span className="right">{money(tot.gross_cents)}</span>
                {tot.discount_cents > 0 && <><span>Descontos</span><span className="right">− {money(tot.discount_cents)}</span></>}
                {tot.fee_cents > 0 && <><span>Taxa de serviço</span><span className="right">{money(tot.fee_cents)}</span></>}
                <span className="t">Total devido</span><span className="t right">{money(tot.net_cents)}</span>
                <span>Pago (confirmado)</span><span className="right">{money(tot.paid_cents)}</span>
                {tot.pending_cents > 0 && <><span>Pendente de confirmação</span><span className="right">{money(tot.pending_cents)}</span></>}
                <span className="t">Saldo</span><span className={`t right ${tot.balance_cents > 0 ? 'pos' : 'neg'}`}>{money(tot.balance_cents)}</span>
              </div>
              {tot.cancelled_cents > 0 && <p className="muted" style={{ fontSize: 12 }}>Itens cancelados: {money(tot.cancelled_cents)}</p>}
              {tab.checked_by_name && <p className="muted" style={{ fontSize: 12 }}>Conferida por {tab.checked_by_name} em {dt(tab.checked_at)}</p>}
              {lastChange ? <p className="neg">Troco a devolver: {money(lastChange)}</p> : null}
              <div className="row" style={{ marginTop: 10 }}>
                {tab.status === 'aberta' && <button className="btn" onClick={() => post('checkout', 'Conferência iniciada')}>Iniciar conferência</button>}
                {tab.status === 'em_conferencia' && <button className="btn" onClick={() => post('confirm-statement', 'Extrato confirmado pelo cliente')}>Cliente conferiu o extrato</button>}
                {['em_conferencia', 'aguardando_pagamento', 'parcialmente_paga', 'paga'].includes(tab.status) && !tot.paid_cents && !tot.pending_cents && <button className="btn ghost" onClick={() => post('resume', 'Comanda voltou para aberta')}>Voltar p/ aberta</button>}
                {['em_conferencia', 'aguardando_pagamento', 'parcialmente_paga', 'paga'].includes(tab.status) && <button className="btn ok" onClick={close}>Encerrar comanda</button>}
                {tab.status === 'encerrada' && <button className="btn warn" onClick={reopen}>Reabrir</button>}
                {tab.status === 'aberta' && supervisorUp && <button className="btn ghost" onClick={() => block(true)}>Bloquear</button>}
                {tab.status === 'bloqueada' && supervisorUp && <button className="btn ghost" onClick={() => block(false)}>Desbloquear</button>}
                {['aberta', 'bloqueada'].includes(tab.status) && !tot.gross_cents && <button className="btn ghost" onClick={cancelTab}>Cancelar abertura</button>}
                <Link className="btn ghost" href={`/extrato/${tab.id}`} target="_blank">Imprimir extrato</Link>
              </div>
            </div>

            {payable && tot.balance_cents - tot.pending_cents > 0 && (
              <div className="card">
                <h2>Registrar pagamento</h2>
                <div className="row">
                  <label>Forma<select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Valor (R$)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
                </div>
                {method === 'dinheiro' ? <label>Valor recebido (R$) — para calcular o troco<input value={received} onChange={(e) => setReceived(e.target.value)} inputMode="decimal" /></label>
                  : <>
                    <label>Referência da transação (NSU / ID Pix)<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
                    <label className="check"><input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} /> Registrar como pendente de confirmação</label></>}
                <button className="btn" style={{ width: '100%' }} disabled={!cash} onClick={pay}>{cash ? 'Registrar pagamento' : 'Abra o caixa para receber'}</button>
              </div>
            )}

            {editable && tot.gross_cents > 0 && (
              <div className="card">
                <h2>Desconto</h2>
                <div className="row"><label style={{ maxWidth: 130 }}>Tipo<select value={dType} onChange={(e) => setDType(e.target.value)}><option value="valor">Valor (R$)</option><option value="percentual">Percentual (%)</option></select></label>
                  <label>{dType === 'valor' ? 'Valor (R$)' : 'Percentual'}<input value={dVal} onChange={(e) => setDVal(e.target.value)} inputMode="decimal" /></label></div>
                <label>Motivo<input value={dReason} onChange={(e) => setDReason(e.target.value)} /></label>
                <button className="btn ghost" disabled={dReason.trim().length < 3 || !dVal} onClick={discount}>Aplicar desconto</button>
                {!supervisorUp && <p className="muted" style={{ fontSize: 12 }}>Será pedida a autorização de um supervisor.</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {closing && (
        <Modal title="Fechar caixa" onClose={() => setClosing(false)}>
          <p className="muted">Dinheiro esperado em caixa: <b>{money(cash?.expected_cash_cents)}</b> (troco inicial + dinheiro recebido − estornos em dinheiro).</p>
          <label>Valor contado em dinheiro (R$)<input value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus inputMode="decimal" /></label>
          <div className="row end"><button className="btn ghost" onClick={() => setClosing(false)}>Cancelar</button><button className="btn warn" onClick={closeCash}>Fechar caixa</button></div>
        </Modal>
      )}
      {approval.dialog}{prompt.dialog}
    </Shell>
  );
}
