'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Modal, useToast } from '@/components/ui';
import { api, dt, money, parseMoney } from '@/lib/api';

const empty = { id: '', code: '', name: '', category: 'Geral', unit: 'un', price: '', active: true, sectors: '', promo: '', promoStart: '', promoEnd: '' };
const toLocal = (s?: string | null) => (s ? new Date(new Date(s).getTime() - new Date(s).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function Produtos() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]); const [form, setForm] = useState<any>(null); const [hist, setHist] = useState<any>(null); const [q, setQ] = useState('');
  const load = useCallback(() => api('GET', '/products').then(setRows).catch(toast.err), []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  const edit = (p: any) => setForm({ id: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit, price: (p.price_cents / 100).toFixed(2).replace('.', ','), active: p.active,
    sectors: p.sectors.join(', '), promo: p.promo_price_cents != null ? (p.promo_price_cents / 100).toFixed(2).replace('.', ',') : '', promoStart: toLocal(p.promo_starts_at), promoEnd: toLocal(p.promo_ends_at) });
  const save = async () => {
    try {
      const price = parseMoney(form.price); if (isNaN(price)) throw new Error('Preço inválido');
      const body: any = { code: form.code, name: form.name, category: form.category, unit: form.unit, price_cents: price, active: form.active,
        sectors: form.sectors.split(',').map((s: string) => s.trim()).filter(Boolean) };
      if (form.promo) { body.promo_price_cents = parseMoney(form.promo); body.promo_starts_at = form.promoStart ? new Date(form.promoStart).toISOString() : null; body.promo_ends_at = form.promoEnd ? new Date(form.promoEnd).toISOString() : null; }
      else { body.promo_price_cents = null; body.promo_starts_at = null; body.promo_ends_at = null; }
      if (form.id) await api('PATCH', `/products/${form.id}`, body); else await api('POST', '/products', body);
      toast.ok('Produto salvo'); setForm(null); load();
    } catch (e) { toast.err(e); }
  };
  const f = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <Shell roles={['gerente', 'admin']}>
      <div className="row between"><h1>Produtos e preços</h1><button className="btn" onClick={() => setForm({ ...empty })}>Novo produto</button></div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <input placeholder="Filtrar" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
        <table><thead><tr><th>Código</th><th>Produto</th><th>Categoria</th><th className="num">Preço</th><th className="num">Vigente</th><th>Setores</th><th>Ativo</th><th /></tr></thead>
          <tbody>{rows.filter((p) => !q || (p.name + p.code + p.category).toLowerCase().includes(q.toLowerCase())).map((p) => (
            <tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.category}</td><td className="num">{money(p.price_cents)}</td>
              <td className="num">{money(p.effective_price_cents)}{p.promo_now ? ' 🏷' : ''}</td><td className="muted">{p.sectors.join(', ') || 'todos'}</td><td>{p.active ? 'sim' : 'não'}</td>
              <td><button className="btn ghost sm" onClick={() => edit(p)}>editar</button> <button className="btn ghost sm" onClick={async () => setHist({ p, rows: await api('GET', `/products/${p.id}/prices`) })}>histórico</button></td></tr>))}</tbody></table>
      </div>
      {form && (
        <Modal title={form.id ? 'Editar produto' : 'Novo produto'} onClose={() => setForm(null)}>
          <div className="row"><label>Código<input value={form.code} onChange={f('code')} /></label><label>Categoria<input value={form.category} onChange={f('category')} /></label></div>
          <label>Nome<input value={form.name} onChange={f('name')} /></label>
          <div className="row"><label>Preço (R$)<input value={form.price} onChange={f('price')} inputMode="decimal" /></label><label>Unidade<input value={form.unit} onChange={f('unit')} /></label></div>
          <label>Setores/PDVs que podem vender (vazio = todos; ex.: bar, cozinha)<input value={form.sectors} onChange={f('sectors')} /></label>
          <div className="row"><label>Preço promocional (R$)<input value={form.promo} onChange={f('promo')} inputMode="decimal" /></label><label>Início<input type="datetime-local" value={form.promoStart} onChange={f('promoStart')} /></label><label>Fim<input type="datetime-local" value={form.promoEnd} onChange={f('promoEnd')} /></label></div>
          <label className="check"><input type="checkbox" checked={form.active} onChange={f('active')} /> Ativo</label>
          <p className="muted" style={{ fontSize: 12 }}>Alterar o preço não muda comandas já lançadas: cada item guarda o preço da hora do lançamento.</p>
          <div className="row end"><button className="btn ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn" onClick={save}>Salvar</button></div>
        </Modal>
      )}
      {hist && (
        <Modal title={`Histórico de preços — ${hist.p.name}`} onClose={() => setHist(null)}>
          <table><thead><tr><th>Quando</th><th className="num">Preço</th><th>Promoção</th><th>Por</th></tr></thead><tbody>{hist.rows.map((r: any) => (
            <tr key={r.id}><td>{dt(r.changed_at)}</td><td className="num">{money(r.price_cents)}</td><td>{r.promo_price_cents != null ? `${money(r.promo_price_cents)} (${dt(r.promo_starts_at)} → ${dt(r.promo_ends_at)})` : '—'}</td><td>{r.changed_by_name ?? '—'}</td></tr>))}</tbody></table>
          <div className="row end"><button className="btn" onClick={() => setHist(null)}>Fechar</button></div>
        </Modal>
      )}
    </Shell>
  );
}
