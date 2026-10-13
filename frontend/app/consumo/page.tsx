'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, useApproval, usePrompt, useToast } from '@/components/ui';
import { api, ApiError, money, newKey } from '@/lib/api';

export default function Consumo() {
  const toast = useToast(); const approval = useApproval(); const prompt = usePrompt();
  const [num, setNum] = useState(''); const [tab, setTab] = useState<any>(null); const [items, setItems] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]); const [cat, setCat] = useState(''); const [q, setQ] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({}); const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  useEffect(() => { api('GET', '/products?active=true&for_terminal=true').then(setProducts).catch(toast.err); }, []); // eslint-disable-line
  const cats = useMemo(() => [...new Set(products.map((p) => p.category))], [products]);
  const shown = products.filter((p) => (!cat || p.category === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.code.toLowerCase().includes(q.toLowerCase())));
  const byId = (id: string) => products.find((p) => p.id === id);
  const total = Object.entries(cart).reduce((s, [id, n]) => s + n * (byId(id)?.effective_price_cents ?? 0), 0);

  const loadTab = async (n: string) => {
    const t = await api('GET', `/tabs/${encodeURIComponent(n)}`);
    setTab(t); setItems(await api('GET', `/tabs/${t.id}/items`));
  };
  const search = async () => { try { setCart({}); key.current = null; await loadTab(num); } catch (e) { setTab(null); setItems([]); toast.err(e); } };
  const change = (id: string, d: number) => { key.current = null; setCart((c) => { const n = (c[id] ?? 0) + d; const x = { ...c }; if (n <= 0) delete x[id]; else x[id] = Math.min(n, 999); return x; }); };

  const launch = async () => {
    if (!tab || !Object.keys(cart).length) return;
    setBusy(true);
    key.current ||= newKey(); // mesma chave em reenvios: evita duplicar item se a rede falhar
    try {
      const r = await api('POST', `/tabs/${tab.id}/items`, { items: Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity })) }, { key: key.current });
      toast.ok(r.replayed ? 'Lançamento já havia sido registrado' : 'Itens lançados'); setCart({}); key.current = null; await loadTab(tab.id);
    } catch (e) { if (!(e instanceof ApiError && e.status === 0)) key.current = null; toast.err(e); } finally { setBusy(false); }
  };
  const cancelItem = async (it: any) => {
    try {
      const reason = await prompt.prompt(`Cancelar "${it.description}"`, 'Motivo do cancelamento');
      await approval.run((a) => api('POST', `/tabs/${tab.id}/adjustments`, { type: 'cancelamento', item_id: it.id, reason, approval: a }));
      toast.ok('Item cancelado (histórico preservado)'); await loadTab(tab.id);
    } catch (e) { if ((e as Error).message !== 'Cancelado' && (e as Error).message !== 'Autorização cancelada') toast.err(e); }
  };
  const open = tab?.status === 'aberta';

  return (
    <Shell roles={['atendente', 'caixa', 'supervisor', 'gerente', 'admin']}>
      <h1>Registro de consumo</h1>
      <div className="card row">
        <label style={{ maxWidth: 220 }}>Número da comanda<input value={num} onChange={(e) => setNum(e.target.value)} inputMode="numeric" autoFocus onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="00428" /></label>
        <button className="btn" onClick={search} style={{ marginTop: 8 }}>Buscar</button>
        {tab && <div style={{ marginLeft: 12 }}><span className="big" style={{ fontSize: 26 }}>{tab.number}</span> <Badge status={tab.status} /> <span className="muted">{tab.consumer?.name} · consumo {money(tab.totals.gross_cents)}</span></div>}
      </div>
      {tab && !open && <div className="card" style={{ background: '#fef3c7' }}>Esta comanda está <b>{tab.status.replace(/_/g, ' ')}</b> e não aceita novos lançamentos.</div>}
      {tab && (
        <div className="split">
          <div className="card">
            <div className="chips"><button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>Todos</button>
              {cats.map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
            <input placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
            <div className="products">{shown.map((p) => (
              <button key={p.id} className="prod" disabled={!open} onClick={() => change(p.id, 1)}><b>{p.name}</b><span>{money(p.effective_price_cents)}{p.promo_now ? ' · promo' : ''}</span></button>
            ))}</div>
          </div>
          <div>
            <div className="card">
              <h2>Pedido</h2>
              {!Object.keys(cart).length && <p className="muted">Toque nos produtos para adicionar.</p>}
              <table><tbody>{Object.entries(cart).map(([id, n]) => (
                <tr key={id}><td>{byId(id)?.name}</td><td><div className="qty"><button onClick={() => change(id, -1)}>−</button>{n}<button onClick={() => change(id, 1)}>+</button></div></td><td className="num">{money(n * (byId(id)?.effective_price_cents ?? 0))}</td></tr>
              ))}</tbody></table>
              <div className="row between" style={{ marginTop: 10 }}><b>Total do pedido</b><b>{money(total)}</b></div>
              <button className="btn ok" style={{ width: '100%', marginTop: 10 }} disabled={busy || !open || !total} onClick={launch}>{busy ? 'Lançando…' : 'Confirmar lançamento'}</button>
            </div>
            <div className="card">
              <h2>Extrato rápido</h2>
              <table><tbody>{items.map((i) => (
                <tr key={i.id} className={i.status === 'cancelado' ? 'cancelled' : ''}>
                  <td>{i.quantity}× {i.description}</td><td className="num">{money(i.subtotal_cents)}</td>
                  <td className="keep">{i.status === 'valido' && tab.status !== 'encerrada' && <button className="btn ghost sm" onClick={() => cancelItem(i)}>cancelar</button>}</td>
                </tr>
              ))}</tbody></table>
              <div className="row between" style={{ marginTop: 8 }}><b>Consumo</b><b>{money(tab.totals.gross_cents)}</b></div>
            </div>
          </div>
        </div>
      )}
      {approval.dialog}{prompt.dialog}
    </Shell>
  );
}
