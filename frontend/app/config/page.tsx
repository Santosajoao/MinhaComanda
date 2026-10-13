'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { useToast } from '@/components/ui';
import { api, dt } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Config() {
  const toast = useToast(); const { refresh } = useAuth();
  const [e, setE] = useState<any>(null); const [events, setEvents] = useState<any[]>([]); const [terms, setTerms] = useState<any[]>([]);
  const [evName, setEvName] = useState(''); const [tName, setTName] = useState(''); const [tSector, setTSector] = useState('bar');
  const load = useCallback(async () => { try { setE(await api('GET', '/establishment')); setEvents(await api('GET', '/events')); setTerms(await api('GET', '/terminals')); } catch (x) { toast.err(x); } }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  if (!e) return <Shell roles={['gerente', 'admin']}><p className="muted">Carregando…</p></Shell>;
  const set = (k: string, v: any) => setE({ ...e, [k]: v });
  const save = async () => {
    try {
      const { id, ...body } = e;
      await api('PATCH', '/establishment', { ...body, number_pad: +body.number_pad, number_min: +body.number_min, number_max: +body.number_max, service_fee_bps: Math.round(+body.service_fee_bps), max_discount_bps: Math.round(+body.max_discount_bps) });
      toast.ok('Configurações salvas'); await refresh(); load();
    } catch (x) { toast.err(x); }
  };
  const run = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.ok(ok); load(); } catch (x) { toast.err(x); } };
  return (
    <Shell roles={['gerente', 'admin']}>
      <h1>Configurações</h1>
      <div className="card">
        <h2>Estabelecimento e regras</h2>
        <label>Nome<input value={e.name} onChange={(x) => set('name', x.target.value)} /></label>
        <div className="row">
          <label>Numeração<select value={e.number_mode} onChange={(x) => set('number_mode', x.target.value)}><option value="auto">Automática (ou informada)</option><option value="manual">Manual (cartões/pulseiras cadastrados)</option></select></label>
          <label>Faixa — de<input type="number" value={e.number_min} onChange={(x) => set('number_min', x.target.value)} /></label>
          <label>até<input type="number" value={e.number_max} onChange={(x) => set('number_max', x.target.value)} /></label>
          <label>Dígitos (zeros à esquerda)<input type="number" value={e.number_pad} onChange={(x) => set('number_pad', x.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={e.number_reuse} onChange={(x) => set('number_reuse', x.target.checked)} /> Permitir reutilizar o número depois que a comanda for encerrada (se desmarcado, o número fica indisponível durante todo o evento)</label>
        <div className="row">
          <label>Política de CPF<select value={e.cpf_policy} onChange={(x) => set('cpf_policy', x.target.value)}><option value="optional">Opcional</option><option value="required">Obrigatório</option><option value="none">Não coletar</option></select></label>
          <label>Taxa de serviço (pontos-base; 1000 = 10%)<input type="number" value={e.service_fee_bps} onChange={(x) => set('service_fee_bps', x.target.value)} /></label>
          <label>Limite de desconto do supervisor (pontos-base; 1000 = 10%)<input type="number" value={e.max_discount_bps} onChange={(x) => set('max_discount_bps', x.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={e.allow_partial_payment} onChange={(x) => set('allow_partial_payment', x.target.checked)} /> Permitir pagamento parcial / combinado (várias formas de pagamento)</label>
        <p className="muted" style={{ fontSize: 12 }}>A taxa de serviço vale para comandas abertas a partir de agora (cada comanda guarda a taxa vigente na abertura).</p>
        <button className="btn" onClick={save}>Salvar configurações</button>
      </div>
      <div className="grid g2">
        <div className="card"><h2>Eventos / sessões</h2>
          <div className="row"><label>Novo evento<input value={evName} onChange={(x) => setEvName(x.target.value)} /></label><button className="btn" onClick={() => run(async () => { await api('POST', '/events', { name: evName }); setEvName(''); }, 'Evento criado')}>Criar</button></div>
          <table><tbody>{events.map((v) => <tr key={v.id}><td>{v.name}</td><td className="muted">{dt(v.starts_at)}</td><td>{v.status}</td>
            <td>{v.status === 'aberto' && <button className="btn ghost sm" onClick={() => run(() => api('POST', `/events/${v.id}/close`), 'Evento encerrado')}>encerrar</button>}</td></tr>)}</tbody></table>
          <p className="muted" style={{ fontSize: 12 }}>Novas comandas entram automaticamente no evento aberto mais recente.</p></div>
        <div className="card"><h2>Terminais / pontos de venda</h2>
          <div className="row"><label>Nome<input value={tName} onChange={(x) => setTName(x.target.value)} /></label><label>Setor<input value={tSector} onChange={(x) => setTSector(x.target.value)} /></label>
            <button className="btn" onClick={() => run(async () => { await api('POST', '/terminals', { name: tName, sector: tSector }); setTName(''); }, 'Terminal criado')}>Criar</button></div>
          <table><tbody>{terms.map((t) => <tr key={t.id}><td>{t.name}</td><td className="muted">{t.sector}</td><td>{t.active ? 'ativo' : 'inativo'}</td>
            <td><button className="btn ghost sm" onClick={() => run(() => api('PATCH', `/terminals/${t.id}`, { active: !t.active }), 'Terminal atualizado')}>{t.active ? 'desativar' : 'ativar'}</button></td></tr>)}</tbody></table></div>
      </div>
    </Shell>
  );
}
