import { Body, Controller, Get, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService, Q } from '../../common/database/database.service';
import { conflict, notFound } from '../../common/errors/app-error';
import { cents, parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';

const CASHIER: any[] = ['caixa', 'supervisor', 'gerente', 'admin'];

@Injectable()
export class CashRegisterService {
  constructor(private db: DatabaseService, private audit: AuditService) {}

  async summary(q: Q, sessionId: string) {
    const s = (await q.query('SELECT * FROM cash_sessions WHERE id=$1', [sessionId])).rows[0];
    const byMethod = (await q.query(
      `SELECT method, COUNT(*)::int AS count, COALESCE(SUM(amount_cents),0)::bigint AS total_cents FROM payments
       WHERE cash_session_id=$1 AND status='confirmado' GROUP BY method ORDER BY method`, [sessionId])).rows;
    const cashIn = byMethod.find((m) => m.method === 'dinheiro')?.total_cents ?? 0;
    const refunds = (await q.query(
      `SELECT COALESCE(SUM(r.amount_cents),0)::bigint AS t FROM payment_refunds r JOIN payments p ON p.id=r.payment_id
       WHERE r.cash_session_id=$1 AND p.method='dinheiro'`, [sessionId])).rows[0].t;
    const pending = (await q.query(`SELECT COUNT(*)::int AS n FROM payments WHERE cash_session_id=$1 AND status='pendente'`, [sessionId])).rows[0].n;
    return { ...s, by_method: byMethod, cash_in_cents: cashIn, cash_refunds_cents: refunds, pending_payments: pending, expected_cash_cents: s.opening_cents + cashIn - refunds };
  }

  async open(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({ opening_cents: cents.default(0) }), raw);
    return this.db.tx(async (c) => {
      const s = (await c.query('INSERT INTO cash_sessions (establishment_id,user_id,terminal_id,opening_cents) VALUES ($1,$2,$3,$4) RETURNING id',
        [ctx.user.establishmentId, ctx.user.id, ctx.terminalId, b.opening_cents])).rows[0];
      await this.audit.log(c, ctx, { type: 'cash.open', entity: 'cash_session', entityId: s.id, after: { opening_cents: b.opening_cents } });
      return this.summary(c, s.id);
    });
  }

  async current(ctx: Ctx) {
    const s = (await this.db.query(`SELECT id FROM cash_sessions WHERE user_id=$1 AND status='aberto'`, [ctx.user.id])).rows[0];
    return s ? this.summary(this.db, s.id) : null;
  }

  async close(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({ counted_cents: cents, notes: z.string().trim().max(300).optional() }), raw);
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT id FROM cash_sessions WHERE user_id=$1 AND status='aberto' FOR UPDATE`, [ctx.user.id])).rows[0];
      if (!s) throw notFound('Você não possui caixa aberto');
      const sum = await this.summary(c, s.id);
      if (sum.pending_payments > 0) throw conflict(`Existem ${sum.pending_payments} pagamento(s) pendente(s) neste caixa. Confirme, recuse ou cancele antes de fechar`, 'PAGAMENTOS_PENDENTES');
      const diff = b.counted_cents - sum.expected_cash_cents;
      await c.query(`UPDATE cash_sessions SET status='fechado', closed_at=now(), counted_cents=$2, expected_cents=$3, difference_cents=$4, notes=$5 WHERE id=$1`,
        [s.id, b.counted_cents, sum.expected_cash_cents, diff, b.notes ?? null]);
      await this.audit.log(c, ctx, { type: 'cash.close', entity: 'cash_session', entityId: s.id, after: { counted_cents: b.counted_cents, expected_cents: sum.expected_cash_cents, difference_cents: diff }, reason: b.notes });
      return this.summary(c, s.id);
    });
  }

  async sessions(ctx: Ctx) {
    const all = ['gerente', 'admin', 'auditor', 'supervisor'].includes(ctx.user.role);
    const r = await this.db.query(
      `SELECT s.*, u.name AS user_name, t.name AS terminal_name FROM cash_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN terminals t ON t.id=s.terminal_id
       WHERE s.establishment_id=$1 ${all ? '' : 'AND s.user_id=$2'} ORDER BY s.opened_at DESC LIMIT 100`, all ? [ctx.user.establishmentId] : [ctx.user.establishmentId, ctx.user.id]);
    return r.rows;
  }
}

@Controller('cash-register')
export class CashRegisterController {
  constructor(private svc: CashRegisterService) {}
  @Post('open') @Roles(...CASHIER) open(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.open(ctx, b); }
  @Get('current') @Roles(...CASHIER) current(@CurrentCtx() ctx: Ctx) { return this.svc.current(ctx); }
  @Post('close') @HttpCode(200) @Roles(...CASHIER) close(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.close(ctx, b); }
  @Get('sessions') @Roles(...CASHIER, 'auditor') sessions(@CurrentCtx() ctx: Ctx) { return this.svc.sessions(ctx); }
}

@Module({ providers: [CashRegisterService], controllers: [CashRegisterController] })
export class CashRegisterModule {}
