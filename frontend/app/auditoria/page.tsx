'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { useToast } from '@/components/ui';
import { api, dt } from '@/lib/api';

export default function Auditoria() {
  const toast = useToast();
  const [type, setType] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: '200' }); if (type) p.set('type', type); if (from) p.set('from', from); if (to) p.set('to', to);
    api('GET', `/audit-events?${p}`).then(setRows).catch(toast.err);
  }, [type, from, to]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  return (
    <Shell roles={['gerente', 'admin', 'auditor']}>
      <h1>Auditoria</h1>
      <div className="card row"><label>Tipo (prefixo, ex.: tab, payment, adjustment, product)<input value={type} onChange={(e) => setType(e.target.value)} /></label>
        <label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={load}>Atualizar</button></div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Quando</th><th>Usuário</th><th>Operação</th><th>Registro</th><th>Motivo</th><th /></tr></thead><tbody>{rows.flatMap((r) => [
          <tr key={r.id}><td>{dt(r.created_at)}</td><td>{r.user_name ?? '—'}</td><td><b>{r.type}</b></td><td className="muted">{r.entity}</td><td>{r.reason}</td><td><button className="btn ghost sm" onClick={() => setOpen(open === r.id ? null : r.id)}>detalhes</button></td></tr>,
          open === r.id && <tr key={`${r.id}d`}><td colSpan={6}><pre>{JSON.stringify({ entity_id: r.entity_id, terminal: r.terminal_id, request: r.request_id, before: r.before, after: r.after }, null, 2)}</pre></td></tr>,
        ])}</tbody></table>
        {!rows.length && <p className="muted">Nenhum evento.</p>}
      </div>
    </Shell>
  );
}
