'use client';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, dt } from '@/lib/api';

export default function Recepcao() {
  const { me } = useAuth(); const toast = useToast();
  const est = me?.establishment;
  const [number, setNumber] = useState(''); const [name, setName] = useState(''); const [cpf, setCpf] = useState('');
  const [created, setCreated] = useState<any>(null); const [tabs, setTabs] = useState<any[]>([]); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('GET', `/tabs?status=aberta,bloqueada,em_conferencia,aguardando_pagamento,parcialmente_paga,paga&limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setTabs).catch(toast.err), [q]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const t = await api('POST', '/tabs', { number: number || undefined, name, cpf: cpf || undefined });
      setCreated(t); setNumber(''); setName(''); setCpf(''); toast.ok(`Comanda ${t.number} aberta`); load();
    } catch (err) { toast.err(err); } finally { setBusy(false); }
  };
  return (
    <Shell roles={['recepcao', 'caixa', 'supervisor', 'gerente', 'admin']}>
      <h1>Recepção — abertura de comanda</h1>
      <div className="split">
        <div>
          <form className="card" onSubmit={submit}>
            <div className="row">
              <label>Número da comanda {est?.number_mode === 'auto' ? '(vazio = automático)' : '(obrigatório)'}
                <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" placeholder={est?.number_mode === 'auto' ? 'automático' : '00428'} required={est?.number_mode === 'manual'} />
              </label>
              <label>Nome do consumidor<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></label>
            </div>
            {est?.cpf_policy !== 'none' && (
              <label>CPF {est?.cpf_policy === 'required' ? '(obrigatório)' : '(opcional)'}
                <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" required={est?.cpf_policy === 'required'} />
              </label>
            )}
            <p className="muted" style={{ fontSize: 12 }}>O CPF é apenas dado cadastral: a conta pertence ao número da comanda.</p>
            <button className="btn" disabled={busy}>{busy ? 'Abrindo…' : 'Confirmar abertura'}</button>
          </form>
          {created && (
            <div className="card"><div className="muted">Comanda aberta</div><div className="big">{created.number}</div>
              <div>{created.consumer?.name} {created.consumer?.cpf_masked && <span className="muted">· CPF {created.consumer.cpf_masked}</span>}</div>
              <div className="muted">{dt(created.opened_at)} {created.event_name && `· ${created.event_name}`}</div></div>
          )}
        </div>
        <div className="card">
          <h2>Comandas ativas</h2>
          <input placeholder="Buscar por número ou nome" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <table><tbody>{tabs.map((t) => (
            <tr key={t.id}><td><b>{t.number}</b></td><td>{t.consumer?.name}</td><td><Badge status={t.status} /></td><td><Link href={`/extrato/${t.id}`}>extrato</Link></td></tr>
          ))}</tbody></table>
          {!tabs.length && <p className="muted">Nenhuma comanda ativa.</p>}
        </div>
      </div>
    </Shell>
  );
}
