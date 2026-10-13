import { Body, Controller, HttpCode, Injectable, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService } from '../../common/database/database.service';
import { AppError, conflict, notFound, unprocessable } from '../../common/errors/app-error';
import { approvalSchema, parse, reasonSchema } from '../../common/validation/parse';
import { ApprovalService } from '../auth/auth.module';
import { AuditService } from '../audit/audit.service';
import { TabsModule } from '../tabs/tabs.module';
import { TabsService } from '../tabs/tabs.service';

const EDITABLE = ['aberta', 'em_conferencia', 'aguardando_pagamento', 'parcialmente_paga'];
const AUTHORITY: any[] = ['supervisor', 'gerente', 'admin'];

const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cancelamento'), item_id: z.string().uuid(), reason: reasonSchema, approval: approvalSchema }),
  z.object({ type: z.literal('desconto'), amount_cents: z.number().int().positive().optional(), percent: z.number().positive().max(100).optional(), reason: reasonSchema, approval: approvalSchema }),
]);

@Injectable()
export class AdjustmentsService {
  constructor(private db: DatabaseService, private audit: AuditService, private tabs: TabsService, private approval: ApprovalService) {}

  async create(ctx: Ctx, tabId: string, raw: unknown) {
    const b = parse(schema, raw);
    return this.db.tx(async (c) => {
      const tab = await this.tabs.lock(c, ctx, tabId);
      if (!EDITABLE.includes(tab.status)) throw conflict('Nesta situação a comanda não aceita cancelamentos ou descontos. Reabra-a se necessário', 'COMANDA_NAO_EDITAVEL');
      const before = (await c.query('SELECT * FROM tab_totals($1)', [tabId])).rows[0];
      let auth = await this.approval.approve(c, ctx, AUTHORITY, b.approval, `adjustment.${b.type}`);
      let adj: any;

      if (b.type === 'cancelamento') {
        const item = (await c.query('SELECT * FROM tab_items WHERE id=$1 AND tab_id=$2 FOR UPDATE', [b.item_id, tabId])).rows[0];
        if (!item) throw notFound('Item não encontrado nesta comanda');
        if (item.status !== 'valido') throw conflict('Item já cancelado', 'ITEM_JA_CANCELADO');
        await c.query(`UPDATE tab_items SET status='cancelado', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 WHERE id=$1`, [item.id, ctx.user.id, b.reason]);
        adj = (await c.query(
          `INSERT INTO tab_adjustments (tab_id,item_id,type,amount_cents,reason,created_by,approved_by) VALUES ($1,$2,'cancelamento',$3,$4,$5,$6) RETURNING *`,
          [tabId, item.id, item.subtotal_cents, b.reason, ctx.user.id, auth.approverId])).rows[0];
      } else {
        if ((b.amount_cents == null) === (b.percent == null)) throw unprocessable('Informe o valor (amount_cents) OU o percentual (percent) do desconto', 'DESCONTO_INVALIDO');
        const gross = before.gross_cents;
        const amount = b.amount_cents ?? Math.round((gross * b.percent!) / 100);
        if (amount <= 0) throw unprocessable('O desconto resultou em valor zero', 'DESCONTO_INVALIDO');
        if (before.discount_cents + amount > gross) throw unprocessable('O desconto total não pode ultrapassar o consumo da comanda', 'DESCONTO_EXCEDE_CONSUMO');
        const est = (await c.query('SELECT max_discount_bps FROM establishments WHERE id=$1', [ctx.user.establishmentId])).rows[0];
        const overLimit = (before.discount_cents + amount) * 10000 > gross * est.max_discount_bps;
        if (overLimit && auth.role === 'supervisor') {
          // acima do limite do supervisor: exige gerente/administrador
          auth = await this.approval.approve(c, ctx, ['gerente', 'admin'], b.approval, 'adjustment.desconto_acima_limite')
            .catch((e: AppError) => { throw new AppError(403, 'DESCONTO_ACIMA_DO_LIMITE', `Desconto acima do limite de ${(est.max_discount_bps / 100).toFixed(2)}% do supervisor: exige autorização de gerente/administrador`); });
        }
        adj = (await c.query(
          `INSERT INTO tab_adjustments (tab_id,type,amount_cents,reason,created_by,approved_by) VALUES ($1,'desconto',$2,$3,$4,$5) RETURNING *`,
          [tabId, amount, b.reason, ctx.user.id, auth.approverId])).rows[0];
      }
      await this.tabs.refreshStatus(c, tabId);
      const after = (await c.query('SELECT * FROM tab_totals($1)', [tabId])).rows[0];
      await this.audit.log(c, ctx, { type: `adjustment.${b.type}`, entity: 'tab', entityId: tabId, reason: b.reason, before, after: { adjustment: adj, totals: after } });
      return { adjustment: adj, tab: await this.tabs.view(c, ctx, tabId) };
    });
  }

  /** Reverte um desconto sem apagá-lo (o registro original fica no histórico). */
  async revoke(ctx: Ctx, tabId: string, adjId: string, raw: unknown) {
    const b = parse(z.object({ reason: reasonSchema, approval: approvalSchema }), raw);
    return this.db.tx(async (c) => {
      const tab = await this.tabs.lock(c, ctx, tabId);
      if (!EDITABLE.includes(tab.status)) throw conflict('Nesta situação a comanda não aceita ajustes', 'COMANDA_NAO_EDITAVEL');
      const auth = await this.approval.approve(c, ctx, AUTHORITY, b.approval, 'adjustment.revoke');
      const a = (await c.query('SELECT * FROM tab_adjustments WHERE id=$1 AND tab_id=$2 FOR UPDATE', [adjId, tabId])).rows[0];
      if (!a) throw notFound('Ajuste não encontrado');
      if (a.type !== 'desconto' || a.revoked_at) throw conflict('Somente descontos ativos podem ser revertidos', 'AJUSTE_NAO_REVERSIVEL');
      await c.query('UPDATE tab_adjustments SET revoked_at=now(), revoked_by=$2, revoke_reason=$3 WHERE id=$1', [adjId, ctx.user.id, b.reason]);
      await this.tabs.refreshStatus(c, tabId);
      await this.audit.log(c, ctx, { type: 'adjustment.revoke', entity: 'tab', entityId: tabId, reason: b.reason, before: a, after: { approved_by: auth.approverId } });
      return { tab: await this.tabs.view(c, ctx, tabId) };
    });
  }
}

@Controller('tabs/:id/adjustments')
export class AdjustmentsController {
  constructor(private svc: AdjustmentsService) {}
  // Atendente/caixa podem solicitar; sem perfil de supervisor, é preciso informar credenciais de aprovação.
  @Post() @HttpCode(201) @Roles('atendente', 'caixa', 'recepcao', 'supervisor', 'gerente', 'admin')
  create(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.create(ctx, id, b); }
  @Post(':adjId/revoke') @HttpCode(200) @Roles('caixa', 'supervisor', 'gerente', 'admin')
  revoke(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('adjId') adjId: string, @Body() b: unknown) { return this.svc.revoke(ctx, id, adjId, b); }
}

@Module({ imports: [TabsModule], providers: [AdjustmentsService], controllers: [AdjustmentsController] })
export class AdjustmentsModule {}
