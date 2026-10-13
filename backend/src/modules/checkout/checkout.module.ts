import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService, Q } from '../../common/database/database.service';
import { conflict } from '../../common/errors/app-error';
import { approvalSchema, parse, reasonSchema } from '../../common/validation/parse';
import { ApprovalService } from '../auth/auth.module';
import { AuditService } from '../audit/audit.service';
import { TabsModule } from '../tabs/tabs.module';
import { FINANCIAL_STATES, TabsService } from '../tabs/tabs.service';

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

@Injectable()
export class CheckoutService {
  constructor(private db: DatabaseService, private audit: AuditService, private tabs: TabsService, private approval: ApprovalService) {}

  /** RF-06: o extrato é sempre montado no servidor a partir dos lançamentos, ajustes e pagamentos. */
  async statement(q: Q, ctx: Ctx, tabId: string) {
    const tab = await this.tabs.view(q, ctx, tabId);
    const items = (await q.query(
      `SELECT i.*, u.name AS created_by_name, tm.name AS terminal_name FROM tab_items i
       LEFT JOIN users u ON u.id=i.created_by LEFT JOIN terminals tm ON tm.id=i.terminal_id WHERE i.tab_id=$1 ORDER BY i.created_at, i.line_no`, [tabId])).rows;
    const adjustments = (await q.query(
      `SELECT a.*, u.name AS created_by_name, ap.name AS approved_by_name, i.description AS item_description
       FROM tab_adjustments a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users ap ON ap.id=a.approved_by LEFT JOIN tab_items i ON i.id=a.item_id
       WHERE a.tab_id=$1 ORDER BY a.created_at`, [tabId])).rows;
    const payments = (await q.query(
      `SELECT p.*, u.name AS created_by_name FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE p.tab_id=$1 ORDER BY p.created_at`, [tabId])).rows;
    const refunds = (await q.query(
      `SELECT r.*, u.name AS requested_by_name, ap.name AS approved_by_name FROM payment_refunds r JOIN payments p ON p.id=r.payment_id
       LEFT JOIN users u ON u.id=r.requested_by LEFT JOIN users ap ON ap.id=r.approved_by WHERE p.tab_id=$1 ORDER BY r.created_at`, [tabId])).rows;
    return { tab, items, adjustments, payments, refunds, generated_at: new Date().toISOString(), generated_by: ctx.user.name };
  }

  async getStatement(ctx: Ctx, key: string) {
    return this.statement(this.db, ctx, await this.tabs.resolveId(this.db, ctx, key));
  }

  async checkout(ctx: Ctx, id: string) {
    return this.db.tx(async (c) => {
      const t = await this.tabs.lock(c, ctx, id);
      if (t.status === 'bloqueada') throw conflict('Comanda bloqueada. Peça a um supervisor para desbloquear', 'COMANDA_BLOQUEADA');
      if (t.status === 'aberta') {
        await c.query(`UPDATE tabs SET status='em_conferencia', checked_by=$2, checked_at=now(), statement_confirmed_at=NULL WHERE id=$1`, [id, ctx.user.id]);
        await this.tabs.refreshStatus(c, id);
        await this.audit.log(c, ctx, { type: 'tab.checkout', entity: 'tab', entityId: id, before: { status: 'aberta' } });
      } else if (!FINANCIAL_STATES.includes(t.status)) {
        throw conflict('Esta comanda não pode entrar em conferência na situação atual', 'ESTADO_INVALIDO');
      }
      return this.statement(c, ctx, id);
    });
  }

  /** O consumidor conferiu o extrato: a conta passa a aguardar pagamento. */
  async confirmStatement(ctx: Ctx, id: string) {
    return this.db.tx(async (c) => {
      const t = await this.tabs.lock(c, ctx, id);
      if (t.status !== 'em_conferencia' && !(FINANCIAL_STATES.includes(t.status) && !t.statement_confirmed_at)) {
        throw conflict('A comanda precisa estar em conferência', 'ESTADO_INVALIDO');
      }
      await c.query(`UPDATE tabs SET statement_confirmed_at=now(), checked_by=$2, status = CASE WHEN status='em_conferencia' THEN 'aguardando_pagamento' ELSE status END WHERE id=$1`, [id, ctx.user.id]);
      await this.tabs.refreshStatus(c, id);
      await this.audit.log(c, ctx, { type: 'tab.statement_confirmed', entity: 'tab', entityId: id });
      return this.statement(c, ctx, id);
    });
  }

  /** Volta para "aberta" para novos lançamentos (somente sem pagamentos confirmados/pendentes). */
  async resume(ctx: Ctx, id: string) {
    return this.db.tx(async (c) => {
      const t = await this.tabs.lock(c, ctx, id);
      if (!FINANCIAL_STATES.includes(t.status)) throw conflict('A comanda não está em conferência/pagamento', 'ESTADO_INVALIDO');
      const pays = await c.query(`SELECT 1 FROM payments WHERE tab_id=$1 AND status IN ('confirmado','pendente') LIMIT 1`, [id]);
      if (pays.rowCount) throw conflict('Existem pagamentos registrados; não é possível voltar para aberta. Peça o estorno ou finalize a conta', 'COMANDA_COM_PAGAMENTOS');
      await c.query(`UPDATE tabs SET status='aberta', statement_confirmed_at=NULL WHERE id=$1`, [id]);
      await this.audit.log(c, ctx, { type: 'tab.resume', entity: 'tab', entityId: id, before: { status: t.status } });
      return this.tabs.view(c, ctx, id);
    });
  }

  async close(ctx: Ctx, id: string, raw: unknown) {
    const b = parse(z.object({ exception: z.object({ reason: reasonSchema }).optional(), approval: approvalSchema }), raw);
    return this.db.tx(async (c) => {
      const t = await this.tabs.lock(c, ctx, id);
      if (t.status === 'encerrada') throw conflict('Comanda já encerrada', 'COMANDA_ENCERRADA');
      if (!FINANCIAL_STATES.includes(t.status)) throw conflict('Faça a conferência da comanda antes de encerrar', 'CONFERENCIA_PENDENTE');
      const x = (await c.query('SELECT * FROM tab_totals($1)', [id])).rows[0];
      const normal = x.balance_cents === 0 && x.pending_cents === 0;
      let exceptionReason: string | null = null;
      let approvedBy: string | null = null;
      if (!normal) {
        // RN-12: o fechamento normal exige saldo zerado e nenhum pagamento pendente.
        if (!b.exception) {
          const why = x.balance_cents > 0 ? `Saldo pendente de ${brl(x.balance_cents)}` : x.balance_cents < 0 ? `Há ${brl(-x.balance_cents)} pago a maior (estorne o excedente)` : `Há ${brl(x.pending_cents)} em pagamentos pendentes de confirmação`;
          throw conflict(`${why}. O fechamento normal exige saldo zerado`, 'SALDO_PENDENTE');
        }
        const ap = await this.approval.approve(c, ctx, ['gerente', 'admin'], b.approval, 'tab.close_exception');
        approvedBy = ap.approverId;
        exceptionReason = b.exception.reason;
        await c.query(`UPDATE payments SET status='cancelado', status_reason='Comanda encerrada com exceção administrativa' WHERE tab_id=$1 AND status='pendente'`, [id]);
      }
      await c.query(`UPDATE tabs SET status='encerrada', closed_at=now(), closed_by=$2, close_exception=$3 WHERE id=$1`, [id, ctx.user.id, exceptionReason]);
      await this.audit.log(c, ctx, { type: normal ? 'tab.close' : 'tab.close_exception', entity: 'tab', entityId: id, reason: exceptionReason, before: x, after: { approved_by: approvedBy } });
      return this.statement(c, ctx, id);
    });
  }

  async reopen(ctx: Ctx, id: string, raw: unknown) {
    const b = parse(z.object({ reason: reasonSchema, approval: approvalSchema }), raw);
    return this.db.tx(async (c) => {
      const t = await this.tabs.lock(c, ctx, id);
      if (t.status !== 'encerrada') throw conflict('Somente comandas encerradas podem ser reabertas', 'ESTADO_INVALIDO');
      const ap = await this.approval.approve(c, ctx, ['supervisor', 'gerente', 'admin'], b.approval, 'tab.reopen');
      await c.query(`UPDATE tabs SET status='aberta', closed_at=NULL, closed_by=NULL, close_exception=NULL, checked_by=NULL, checked_at=NULL,
                     statement_confirmed_at=NULL, reopen_count=reopen_count+1 WHERE id=$1`, [id]);
      await this.audit.log(c, ctx, { type: 'tab.reopen', entity: 'tab', entityId: id, reason: b.reason, before: { status: 'encerrada', close_exception: t.close_exception }, after: { approved_by: ap.approverId } });
      return this.tabs.view(c, ctx, id);
    });
  }
}

@Controller('tabs/:id')
export class CheckoutController {
  constructor(private svc: CheckoutService) {}
  @Get('statement') statement(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.svc.getStatement(ctx, id); }
  @Post('checkout') @HttpCode(200) @Roles('caixa', 'supervisor', 'gerente', 'admin')
  checkout(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.svc.checkout(ctx, id); }
  @Post('confirm-statement') @HttpCode(200) @Roles('caixa', 'supervisor', 'gerente', 'admin')
  confirm(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.svc.confirmStatement(ctx, id); }
  @Post('resume') @HttpCode(200) @Roles('caixa', 'supervisor', 'gerente', 'admin')
  resume(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.svc.resume(ctx, id); }
  @Post('close') @HttpCode(200) @Roles('caixa', 'supervisor', 'gerente', 'admin')
  close(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.close(ctx, id, b); }
  @Post('reopen') @HttpCode(200) @Roles('caixa', 'supervisor', 'gerente', 'admin')
  reopen(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.reopen(ctx, id, b); }
}

@Module({ imports: [TabsModule], providers: [CheckoutService], controllers: [CheckoutController] })
export class CheckoutModule {}
