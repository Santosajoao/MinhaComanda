import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Ctx } from '../../common/authorization/context';
import { DatabaseService, Q } from '../../common/database/database.service';
import { badRequest, conflict, notFound, unprocessable } from '../../common/errors/app-error';
import { maskCpf } from '../../common/validation/cpf';
import { decrypt } from '../../common/crypto/crypto';
import { approvalSchema, parse, reasonSchema } from '../../common/validation/parse';
import { ApprovalService } from '../auth/auth.module';
import { AuditService } from '../audit/audit.service';
import { ConsumersService } from '../consumers/consumers.module';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FINANCIAL_STATES = ['em_conferencia', 'aguardando_pagamento', 'parcialmente_paga', 'paga'];

const VIEW_SQL = `
  SELECT t.*, e.name AS establishment_name, ev.name AS event_name, c.name AS consumer_name, c.cpf_enc,
         uo.name AS opened_by_name, uc.name AS checked_by_name, ucl.name AS closed_by_name,
         x.gross_cents, x.cancelled_cents, x.discount_cents, x.fee_cents, x.net_cents, x.paid_cents, x.pending_cents, x.balance_cents
  FROM tabs t
  JOIN establishments e ON e.id = t.establishment_id
  LEFT JOIN events ev ON ev.id = t.event_id
  LEFT JOIN consumers c ON c.id = t.consumer_id
  LEFT JOIN users uo ON uo.id = t.opened_by
  LEFT JOIN users uc ON uc.id = t.checked_by
  LEFT JOIN users ucl ON ucl.id = t.closed_by
  CROSS JOIN LATERAL tab_totals(t.id) x`;

export function mapTab(r: any) {
  return {
    id: r.id, number: r.number, status: r.status, establishment_id: r.establishment_id, establishment_name: r.establishment_name,
    event_id: r.event_id, event_name: r.event_name, opened_at: r.opened_at, opened_by_name: r.opened_by_name,
    checked_at: r.checked_at, checked_by_name: r.checked_by_name, statement_confirmed_at: r.statement_confirmed_at,
    closed_at: r.closed_at, closed_by_name: r.closed_by_name, close_exception: r.close_exception, reopen_count: r.reopen_count,
    service_fee_bps: r.service_fee_bps, cancel_reason: r.cancel_reason,
    consumer: r.consumer_id ? { id: r.consumer_id, name: r.consumer_name, cpf_masked: r.cpf_enc ? maskCpf(decrypt(r.cpf_enc)) : null } : null,
    totals: {
      gross_cents: r.gross_cents, cancelled_cents: r.cancelled_cents, discount_cents: r.discount_cents, fee_cents: r.fee_cents,
      net_cents: r.net_cents, paid_cents: r.paid_cents, pending_cents: r.pending_cents, balance_cents: r.balance_cents,
    },
  };
}

@Injectable()
export class TabsService {
  constructor(private db: DatabaseService, private audit: AuditService, private consumers: ConsumersService, private approval: ApprovalService) {}

  /** Bloqueia a linha da comanda: serializa lançamentos, pagamentos e fechamento (RN-09, RF-06). */
  async lock(c: Q, ctx: Ctx, id: string) {
    const r = await c.query('SELECT * FROM tabs WHERE id=$1 AND establishment_id=$2 FOR UPDATE', [id, ctx.user.establishmentId]);
    if (!r.rows[0]) throw notFound('Comanda não encontrada');
    return r.rows[0];
  }

  async view(c: Q, ctx: Ctx, id: string) {
    const r = await c.query(`${VIEW_SQL} WHERE t.id=$1 AND t.establishment_id=$2`, [id, ctx.user.establishmentId]);
    if (!r.rows[0]) throw notFound('Comanda não encontrada');
    return mapTab(r.rows[0]);
  }

  async resolveId(c: Q, ctx: Ctx, key: string): Promise<string> {
    if (UUID_RE.test(key)) return key;
    const digits = key.replace(/\D/g, '');
    if (!digits) throw badRequest('Número de comanda inválido', 'NUMERO_INVALIDO');
    const est = (await c.query('SELECT number_pad FROM establishments WHERE id=$1', [ctx.user.establishmentId])).rows[0];
    const number = digits.length >= est.number_pad ? digits : digits.padStart(est.number_pad, '0');
    const r = await c.query(
      `SELECT id FROM tabs WHERE establishment_id=$1 AND number=$2
       ORDER BY (status NOT IN ('encerrada','cancelada')) DESC, opened_at DESC LIMIT 1`, [ctx.user.establishmentId, number]);
    if (!r.rows[0]) throw notFound(`Comanda ${number} não encontrada`);
    return r.rows[0].id;
  }

  async get(ctx: Ctx, key: string) {
    return this.view(this.db, ctx, await this.resolveId(this.db, ctx, key));
  }

  async list(ctx: Ctx, raw: any) {
    const f = parse(z.object({
      status: z.string().optional(), q: z.string().optional(), event_id: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }), raw);
    const w = ['t.establishment_id = $1']; const p: any[] = [ctx.user.establishmentId];
    if (f.status) { p.push(f.status.split(',')); w.push(`t.status = ANY($${p.length})`); }
    if (f.event_id) { p.push(f.event_id); w.push(`t.event_id = $${p.length}`); }
    if (f.q) { p.push(`%${f.q.trim()}%`); w.push(`(t.number LIKE $${p.length} OR c.name ILIKE $${p.length})`); }
    p.push(f.limit);
    const r = await this.db.query(`${VIEW_SQL} WHERE ${w.join(' AND ')} ORDER BY t.opened_at DESC LIMIT $${p.length}`, p);
    return r.rows.map(mapTab);
  }

  normalizeNumber(est: any, raw: string | number): string {
    const digits = String(raw).replace(/\D/g, '');
    if (!digits || digits.length > 12) throw badRequest('Número de comanda inválido', 'NUMERO_INVALIDO');
    const n = parseInt(digits, 10);
    if (n < est.number_min || n > est.number_max) {
      throw unprocessable(`Número fora da faixa configurada (${est.number_min} a ${est.number_max})`, 'NUMERO_FORA_DA_FAIXA');
    }
    return digits.padStart(est.number_pad, '0');
  }

  private async nextNumber(c: Q, est: any, eventId: string | null): Promise<string> {
    const r = await c.query(
      `SELECT lpad(n::text, $4, '0') AS num FROM generate_series($2::int, $3::int) n
       WHERE NOT EXISTS (SELECT 1 FROM tabs t WHERE t.establishment_id=$1 AND t.number = lpad(n::text,$4,'0')
                         AND (t.status NOT IN ('encerrada','cancelada') OR ($5::boolean = false AND $6::uuid IS NOT NULL AND t.event_id = $6::uuid)))
       ORDER BY n LIMIT 1`, [est.id, est.number_min, est.number_max, est.number_pad, est.number_reuse, eventId]);
    if (!r.rows[0]) throw conflict('Todas as comandas da faixa configurada estão em uso', 'SEM_NUMEROS_DISPONIVEIS');
    return r.rows[0].num;
  }

  async open(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({
      number: z.union([z.string(), z.number()]).optional(), name: z.string().optional(), cpf: z.string().optional(),
      consumer_id: z.string().uuid().optional(), event_id: z.string().uuid().optional(),
    }), raw);
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tabs-open:' + ctx.user.establishmentId]);
      const est = (await c.query('SELECT * FROM establishments WHERE id=$1', [ctx.user.establishmentId])).rows[0];

      let eventId: string | null = null;
      if (b.event_id) {
        const ev = await c.query(`SELECT id FROM events WHERE id=$1 AND establishment_id=$2 AND status='aberto'`, [b.event_id, est.id]);
        if (!ev.rowCount) throw unprocessable('Evento inexistente ou já encerrado', 'EVENTO_INVALIDO');
        eventId = b.event_id;
      } else {
        eventId = (await c.query(`SELECT id FROM events WHERE establishment_id=$1 AND status='aberto' ORDER BY starts_at DESC LIMIT 1`, [est.id])).rows[0]?.id ?? null;
      }

      let number: string;
      if (b.number !== undefined && String(b.number).trim() !== '') number = this.normalizeNumber(est, b.number);
      else if (est.number_mode === 'manual') throw badRequest('Informe o número da comanda', 'NUMERO_OBRIGATORIO');
      else number = await this.nextNumber(c, est, eventId);

      const busy = await c.query(`SELECT 1 FROM tabs WHERE establishment_id=$1 AND number=$2 AND status NOT IN ('encerrada','cancelada')`, [est.id, number]);
      if (busy.rowCount) throw conflict(`A comanda ${number} já está aberta`, 'COMANDA_OCUPADA');
      if (!est.number_reuse && eventId) {
        const used = await c.query('SELECT 1 FROM tabs WHERE establishment_id=$1 AND number=$2 AND event_id=$3', [est.id, number, eventId]);
        if (used.rowCount) throw conflict(`A comanda ${number} já foi utilizada neste evento e não pode ser reutilizada`, 'NUMERO_JA_UTILIZADO_NO_EVENTO');
      }

      const consumerId = await this.consumers.resolve(c, ctx, est, b);
      const tab = (await c.query(
        `INSERT INTO tabs (establishment_id,event_id,consumer_id,number,status,service_fee_bps,opened_by,opened_terminal)
         VALUES ($1,$2,$3,$4,'aberta',$5,$6,$7) RETURNING id`,
        [est.id, eventId, consumerId, number, est.service_fee_bps, ctx.user.id, ctx.terminalId])).rows[0];
      await this.audit.log(c, ctx, { type: 'tab.open', entity: 'tab', entityId: tab.id, after: { number, consumer_id: consumerId, event_id: eventId } });
      return this.view(c, ctx, tab.id);
    });
  }

  /** Recalcula o estado financeiro depois de ajustes/pagamentos (chamar dentro da transação, com a comanda bloqueada). */
  async refreshStatus(c: Q, tabId: string) {
    const t = (await c.query(`SELECT t.status, t.statement_confirmed_at, x.* FROM tabs t CROSS JOIN LATERAL tab_totals(t.id) x WHERE t.id=$1`, [tabId])).rows[0];
    if (!FINANCIAL_STATES.includes(t.status)) return t.status;
    let next = t.status;
    if (t.balance_cents === 0 && t.pending_cents === 0) next = 'paga';
    else if (t.paid_cents > 0) next = 'parcialmente_paga';
    else if (t.status === 'paga' || t.status === 'parcialmente_paga') next = t.statement_confirmed_at ? 'aguardando_pagamento' : 'em_conferencia';
    if (next !== t.status) await c.query('UPDATE tabs SET status=$1 WHERE id=$2', [next, tabId]);
    return next;
  }

  async block(ctx: Ctx, id: string, raw: unknown) {
    const b = parse(z.object({ reason: reasonSchema }), raw);
    return this.db.tx(async (c) => {
      const t = await this.lock(c, ctx, id);
      if (t.status !== 'aberta') throw conflict('Somente comandas abertas podem ser bloqueadas', 'ESTADO_INVALIDO');
      await c.query(`UPDATE tabs SET status='bloqueada' WHERE id=$1`, [id]);
      await this.audit.log(c, ctx, { type: 'tab.block', entity: 'tab', entityId: id, reason: b.reason, before: { status: t.status }, after: { status: 'bloqueada' } });
      return this.view(c, ctx, id);
    });
  }

  async unblock(ctx: Ctx, id: string, raw: unknown) {
    const b = parse(z.object({ reason: reasonSchema }), raw);
    return this.db.tx(async (c) => {
      const t = await this.lock(c, ctx, id);
      if (t.status !== 'bloqueada') throw conflict('A comanda não está bloqueada', 'ESTADO_INVALIDO');
      await c.query(`UPDATE tabs SET status='aberta' WHERE id=$1`, [id]);
      await this.audit.log(c, ctx, { type: 'tab.unblock', entity: 'tab', entityId: id, reason: b.reason });
      return this.view(c, ctx, id);
    });
  }

  /** Cancela a abertura (sem apagar histórico) — só sem itens válidos e sem pagamentos. */
  async cancel(ctx: Ctx, id: string, raw: unknown) {
    const b = parse(z.object({ reason: reasonSchema, approval: approvalSchema }), raw);
    return this.db.tx(async (c) => {
      const t = await this.lock(c, ctx, id);
      const ap = await this.approval.approve(c, ctx, ['supervisor', 'gerente', 'admin'], b.approval, 'tab.cancel');
      if (!['aberta', 'bloqueada'].includes(t.status)) throw conflict('Só é possível cancelar comandas abertas ou bloqueadas', 'ESTADO_INVALIDO');
      const x = (await c.query('SELECT * FROM tab_totals($1)', [id])).rows[0];
      const pays = await c.query(`SELECT 1 FROM payments WHERE tab_id=$1 AND status IN ('confirmado','pendente') LIMIT 1`, [id]);
      if (x.gross_cents > 0 || pays.rowCount) throw conflict('Há consumo ou pagamentos nesta comanda; cancele os itens e finalize a conta normalmente', 'COMANDA_COM_MOVIMENTO');
      await c.query(`UPDATE tabs SET status='cancelada', cancel_reason=$2, closed_at=now(), closed_by=$3 WHERE id=$1`, [id, b.reason, ctx.user.id]);
      await this.audit.log(c, ctx, { type: 'tab.cancel', entity: 'tab', entityId: id, reason: b.reason, after: { approved_by: ap.approverId } });
      return this.view(c, ctx, id);
    });
  }
}
