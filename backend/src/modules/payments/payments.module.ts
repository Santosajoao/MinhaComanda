import { Body, Controller, Get, Headers, HttpCode, Injectable, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService } from '../../common/database/database.service';
import { conflict, notFound, unprocessable } from '../../common/errors/app-error';
import { approvalSchema, parse, reasonSchema } from '../../common/validation/parse';
import { ApprovalService } from '../auth/auth.module';
import { AuditService } from '../audit/audit.service';
import { requireKey } from '../orders/orders.module';
import { TabsModule } from '../tabs/tabs.module';
import { TabsService } from '../tabs/tabs.service';

const PAYABLE = ['em_conferencia', 'aguardando_pagamento', 'parcialmente_paga'];
const CASHIER: any[] = ['caixa', 'supervisor', 'gerente', 'admin'];

@Injectable()
export class PaymentsService {
  constructor(private db: DatabaseService, private audit: AuditService, private tabs: TabsService, private approval: ApprovalService) {}

  async create(ctx: Ctx, tabId: string, key: string | undefined, raw: unknown) {
    const k = requireKey(key);
    const b = parse(z.object({
      method: z.enum(['dinheiro', 'pix', 'debito', 'credito', 'outro']), amount_cents: z.number().int().positive().max(100_000_000),
      status: z.enum(['confirmado', 'pendente']).optional(), reference: z.string().trim().max(100).optional(),
      cash_received_cents: z.number().int().positive().optional(),
    }), raw);
    return this.db.tx(async (c) => {
      const tab = await this.tabs.lock(c, ctx, tabId);

      // RN-07: pagamento repetido não é registrado duas vezes.
      const prev = (await c.query(`SELECT p.* FROM payments p JOIN tabs t ON t.id=p.tab_id WHERE p.idempotency_key=$1 AND t.establishment_id=$2`, [k, ctx.user.establishmentId])).rows[0];
      if (prev) {
        if (prev.tab_id !== tabId) throw conflict('Esta chave de idempotência já foi usada em outra comanda', 'IDEMPOTENCIA_CONFLITO');
        return { replayed: true, payment: prev, tab: await this.tabs.view(c, ctx, tabId) };
      }
      if (!PAYABLE.includes(tab.status)) {
        throw conflict(tab.status === 'aberta' ? 'Inicie a conferência da comanda antes de receber pagamentos' : `Comanda em situação "${tab.status}" não aceita pagamentos`, 'COMANDA_NAO_PAGAVEL');
      }
      const session = (await c.query(`SELECT id FROM cash_sessions WHERE user_id=$1 AND status='aberto'`, [ctx.user.id])).rows[0];
      if (!session) throw conflict('Abra o seu caixa antes de registrar pagamentos', 'CAIXA_FECHADO');

      const x = (await c.query('SELECT * FROM tab_totals($1)', [tabId])).rows[0];
      const available = x.balance_cents - x.pending_cents;
      if (available <= 0) throw unprocessable('A comanda não possui saldo a receber', 'SEM_SALDO');
      if (b.amount_cents > available) throw unprocessable(`Valor excede o saldo a receber (R$ ${(available / 100).toFixed(2)})`, 'VALOR_EXCEDE_SALDO');
      const est = (await c.query('SELECT allow_partial_payment FROM establishments WHERE id=$1', [ctx.user.establishmentId])).rows[0];
      if (!est.allow_partial_payment && b.amount_cents !== available) throw unprocessable('Este estabelecimento exige pagamento do valor total (parcial/combinado desabilitado)', 'PAGAMENTO_PARCIAL_NAO_PERMITIDO');

      const cash = b.method === 'dinheiro';
      if (!cash && (!b.reference || b.reference.length < 3)) throw unprocessable('Informe a referência da transação (NSU, ID do Pix, etc.)', 'REFERENCIA_OBRIGATORIA');
      if (cash && b.cash_received_cents != null && b.cash_received_cents < b.amount_cents) throw unprocessable('Valor recebido é menor que o valor do pagamento', 'VALOR_RECEBIDO_INSUFICIENTE');
      const status = cash ? 'confirmado' : b.status ?? 'confirmado'; // dinheiro nunca fica pendente
      const p = (await c.query(
        `INSERT INTO payments (tab_id,cash_session_id,method,amount_cents,status,reference,cash_received_cents,idempotency_key,created_by,terminal_id,confirmed_at,confirmed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [tabId, session.id, b.method, b.amount_cents, status, b.reference ?? null, cash ? b.cash_received_cents ?? null : null, k, ctx.user.id, ctx.terminalId,
          status === 'confirmado' ? new Date() : null, status === 'confirmado' ? ctx.user.id : null])).rows[0];
      await this.tabs.refreshStatus(c, tabId);
      await this.audit.log(c, ctx, { type: 'payment.create', entity: 'payment', entityId: p.id, after: { tab_id: tabId, method: p.method, amount_cents: p.amount_cents, status: p.status, reference: p.reference } });
      const change = cash && b.cash_received_cents ? b.cash_received_cents - b.amount_cents : 0;
      return { replayed: false, payment: p, change_cents: change, tab: await this.tabs.view(c, ctx, tabId) };
    });
  }

  list(ctx: Ctx, tabId: string) {
    return this.tabs.view(this.db, ctx, tabId).then(() => this.db.query(
      `SELECT p.*, u.name AS created_by_name FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE p.tab_id=$1 ORDER BY p.created_at`, [tabId]).then((r) => r.rows));
  }

  /** Confirma/recusa/cancela um pagamento pendente (conciliação com a maquininha ou o provedor). */
  async transition(ctx: Ctx, paymentId: string, action: 'confirm' | 'reject' | 'cancel', raw: unknown) {
    const b = parse(z.object({ reason: z.string().trim().max(300).optional(), reference: z.string().trim().max(100).optional() }), raw);
    const p0 = (await this.db.query('SELECT p.tab_id FROM payments p JOIN tabs t ON t.id=p.tab_id WHERE p.id=$1 AND t.establishment_id=$2', [paymentId, ctx.user.establishmentId])).rows[0];
    if (!p0) throw notFound('Pagamento não encontrado');
    return this.db.tx(async (c) => {
      const tab = await this.tabs.lock(c, ctx, p0.tab_id);
      const p = (await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId])).rows[0];
      if (p.status !== 'pendente') throw conflict('Somente pagamentos pendentes podem ser alterados', 'PAGAMENTO_NAO_PENDENTE');
      if (['encerrada', 'cancelada'].includes(tab.status)) throw conflict('Comanda já encerrada', 'COMANDA_ENCERRADA');
      if (action !== 'confirm' && (!b.reason || b.reason.length < 3)) throw unprocessable('Informe o motivo', 'MOTIVO_OBRIGATORIO');
      if (action === 'confirm') {
        const ref = b.reference ?? p.reference;
        if (!ref || ref.length < 3) throw unprocessable('Informe a referência da transação para confirmar', 'REFERENCIA_OBRIGATORIA');
        await c.query(`UPDATE payments SET status='confirmado', reference=$2, confirmed_at=now(), confirmed_by=$3 WHERE id=$1`, [paymentId, ref, ctx.user.id]);
      } else {
        await c.query('UPDATE payments SET status=$2, status_reason=$3 WHERE id=$1', [paymentId, action === 'reject' ? 'recusado' : 'cancelado', b.reason]);
      }
      await this.tabs.refreshStatus(c, p0.tab_id);
      const fresh = (await c.query('SELECT * FROM payments WHERE id=$1', [paymentId])).rows[0];
      await this.audit.log(c, ctx, { type: `payment.${action}`, entity: 'payment', entityId: paymentId, reason: b.reason, before: { status: p.status }, after: { status: fresh.status, reference: fresh.reference } });
      return { payment: fresh, tab: await this.tabs.view(c, ctx, p0.tab_id) };
    });
  }

  /** Estorno total de um pagamento confirmado: exige gerente/administrador (RF-07.07). */
  async refund(ctx: Ctx, paymentId: string, raw: unknown) {
    const b = parse(z.object({ reason: reasonSchema, approval: approvalSchema }), raw);
    const p0 = (await this.db.query('SELECT p.tab_id FROM payments p JOIN tabs t ON t.id=p.tab_id WHERE p.id=$1 AND t.establishment_id=$2', [paymentId, ctx.user.establishmentId])).rows[0];
    if (!p0) throw notFound('Pagamento não encontrado');
    return this.db.tx(async (c) => {
      const tab = await this.tabs.lock(c, ctx, p0.tab_id);
      const p = (await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId])).rows[0];
      if (p.status !== 'confirmado') throw conflict('Somente pagamentos confirmados podem ser estornados', 'PAGAMENTO_NAO_CONFIRMADO');
      if (tab.status === 'encerrada') throw conflict('A comanda está encerrada: reabra-a (com autorização) antes de estornar', 'COMANDA_ENCERRADA');
      const ap = await this.approval.approve(c, ctx, ['gerente', 'admin'], b.approval, 'payment.refund');
      const session = (await c.query(`SELECT id FROM cash_sessions WHERE user_id=$1 AND status='aberto'`, [ctx.user.id])).rows[0];
      await c.query(`UPDATE payments SET status='estornado', status_reason=$2 WHERE id=$1`, [paymentId, b.reason]);
      const r = (await c.query(
        `INSERT INTO payment_refunds (payment_id,cash_session_id,amount_cents,reason,requested_by,approved_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [paymentId, session?.id ?? null, p.amount_cents, b.reason, ctx.user.id, ap.approverId])).rows[0];
      await this.tabs.refreshStatus(c, p0.tab_id);
      await this.audit.log(c, ctx, { type: 'payment.refund', entity: 'payment', entityId: paymentId, reason: b.reason, before: { status: 'confirmado', amount_cents: p.amount_cents }, after: { refund_id: r.id, approved_by: ap.approverId } });
      return { refund: r, tab: await this.tabs.view(c, ctx, p0.tab_id) };
    });
  }
}

@Controller()
export class PaymentsController {
  constructor(private svc: PaymentsService) {}
  @Post('tabs/:id/payments') @HttpCode(200) @Roles(...CASHIER)
  create(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Headers('idempotency-key') key: string, @Body() b: unknown) { return this.svc.create(ctx, id, key, b); }
  @Get('tabs/:id/payments') list(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.svc.list(ctx, id); }
  @Post('payments/:id/confirm') @HttpCode(200) @Roles(...CASHIER)
  confirm(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.transition(ctx, id, 'confirm', b); }
  @Post('payments/:id/reject') @HttpCode(200) @Roles(...CASHIER)
  reject(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.transition(ctx, id, 'reject', b); }
  @Post('payments/:id/cancel') @HttpCode(200) @Roles(...CASHIER)
  cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.transition(ctx, id, 'cancel', b); }
  // Caixa/supervisor solicitam; sem perfil de gerente, é preciso informar credenciais de aprovação.
  @Post('payments/:id/refunds') @HttpCode(201) @Roles(...CASHIER)
  refund(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.refund(ctx, id, b); }
}

@Module({ imports: [TabsModule], providers: [PaymentsService], controllers: [PaymentsController] })
export class PaymentsModule {}
