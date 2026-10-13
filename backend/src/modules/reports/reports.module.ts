import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService } from '../../common/database/database.service';
import { badRequest } from '../../common/errors/app-error';
import { parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';

const TZ = `'America/Sao_Paulo'`;
const filterSchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), event_id: z.string().uuid().optional() });

@Injectable()
export class ReportsService {
  constructor(private db: DatabaseService, private audit: AuditService) {}

  private async range(raw: unknown) {
    const f = parse(filterSchema, raw);
    const d = (await this.db.query(`SELECT (now() AT TIME ZONE ${TZ})::date AS today`)).rows[0].today as Date;
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const today = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const from = f.from ?? iso(new Date(today.getTime() - 30 * 86400000));
    return { from, to: f.to ?? iso(today), event: f.event_id ?? null };
  }

  async summary(ctx: Ctx, raw: unknown) {
    const { from, to, event } = await this.range(raw);
    const base = [ctx.user.establishmentId, from, to, event];
    const itemWhere = `t.establishment_id=$1 AND (i.created_at AT TIME ZONE ${TZ})::date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR t.event_id=$4)`;
    const tabWhere = `t.establishment_id=$1 AND (t.opened_at AT TIME ZONE ${TZ})::date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR t.event_id=$4)`;
    const q = (sql: string) => this.db.query(sql, base).then((r) => r.rows);

    const [sales_by_day, by_product, by_category, by_terminal, tabs_by_status, payments, ticket, discounts, cancellations, refunds, exceptions, divergences] = await Promise.all([
      q(`SELECT (i.created_at AT TIME ZONE ${TZ})::date AS day, SUM(i.subtotal_cents)::bigint AS total_cents, COUNT(*)::int AS lines
         FROM tab_items i JOIN tabs t ON t.id=i.tab_id WHERE ${itemWhere} AND i.status='valido' GROUP BY 1 ORDER BY 1`),
      q(`SELECT i.description, SUM(i.quantity)::int AS quantity, SUM(i.subtotal_cents)::bigint AS total_cents FROM tab_items i JOIN tabs t ON t.id=i.tab_id
         WHERE ${itemWhere} AND i.status='valido' GROUP BY i.description ORDER BY total_cents DESC`),
      q(`SELECT i.category, SUM(i.quantity)::int AS quantity, SUM(i.subtotal_cents)::bigint AS total_cents FROM tab_items i JOIN tabs t ON t.id=i.tab_id
         WHERE ${itemWhere} AND i.status='valido' GROUP BY i.category ORDER BY total_cents DESC`),
      q(`SELECT COALESCE(tm.name,'(sem terminal)') AS terminal, SUM(i.subtotal_cents)::bigint AS total_cents, COUNT(*)::int AS lines FROM tab_items i JOIN tabs t ON t.id=i.tab_id
         LEFT JOIN terminals tm ON tm.id=i.terminal_id WHERE ${itemWhere} AND i.status='valido' GROUP BY 1 ORDER BY total_cents DESC`),
      q(`SELECT t.status, COUNT(*)::int AS count FROM tabs t WHERE ${tabWhere} GROUP BY 1 ORDER BY 1`),
      q(`SELECT p.method, p.status, COUNT(*)::int AS count, SUM(p.amount_cents)::bigint AS total_cents FROM payments p JOIN tabs t ON t.id=p.tab_id
         WHERE t.establishment_id=$1 AND (p.created_at AT TIME ZONE ${TZ})::date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR t.event_id=$4) GROUP BY 1,2 ORDER BY 1,2`),
      q(`SELECT COUNT(*)::int AS tabs, COALESCE(ROUND(AVG(x.net_cents)),0)::bigint AS avg_cents, COALESCE(SUM(x.net_cents),0)::bigint AS total_cents
         FROM tabs t CROSS JOIN LATERAL tab_totals(t.id) x WHERE ${tabWhere} AND t.status='encerrada'`),
      q(`SELECT COUNT(*)::int AS count, COALESCE(SUM(a.amount_cents),0)::bigint AS total_cents FROM tab_adjustments a JOIN tabs t ON t.id=a.tab_id
         WHERE ${tabWhere} AND a.type='desconto' AND a.revoked_at IS NULL`),
      q(`SELECT COUNT(*)::int AS count, COALESCE(SUM(a.amount_cents),0)::bigint AS total_cents FROM tab_adjustments a JOIN tabs t ON t.id=a.tab_id
         WHERE ${tabWhere} AND a.type='cancelamento'`),
      q(`SELECT COUNT(*)::int AS count, COALESCE(SUM(r.amount_cents),0)::bigint AS total_cents FROM payment_refunds r JOIN payments p ON p.id=r.payment_id JOIN tabs t ON t.id=p.tab_id WHERE ${tabWhere}`),
      q(`SELECT t.id, t.number, t.status, t.close_exception, t.reopen_count, t.closed_at FROM tabs t WHERE ${tabWhere} AND (t.close_exception IS NOT NULL OR t.reopen_count > 0) ORDER BY t.opened_at DESC`),
      q(`SELECT t.id, t.number, t.status, t.close_exception, x.net_cents, x.paid_cents, x.balance_cents FROM tabs t CROSS JOIN LATERAL tab_totals(t.id) x
         WHERE ${tabWhere} AND t.status='encerrada' AND x.balance_cents <> 0 ORDER BY t.closed_at DESC`),
    ]);
    const received = payments.filter((p) => p.status === 'confirmado').reduce((s, p) => s + p.total_cents, 0);
    return {
      period: { from, to, event_id: event },
      totals: {
        gross_sales_cents: sales_by_day.reduce((s, r) => s + r.total_cents, 0), received_cents: received,
        discounts: discounts[0], cancellations: cancellations[0], refunds: refunds[0],
        ticket_medio_cents: ticket[0].avg_cents, closed_tabs: ticket[0].tabs, closed_tabs_net_cents: ticket[0].total_cents,
      },
      sales_by_day, by_product, by_category, by_terminal, tabs_by_status, payments_by_method: payments, exceptions, divergences,
    };
  }

  async cashClosings(ctx: Ctx, raw: unknown) {
    const { from, to } = await this.range(raw);
    return (await this.db.query(
      `SELECT s.*, u.name AS user_name, t.name AS terminal_name FROM cash_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN terminals t ON t.id=s.terminal_id
       WHERE s.establishment_id=$1 AND (s.opened_at AT TIME ZONE ${TZ})::date BETWEEN $2::date AND $3::date ORDER BY s.opened_at DESC`, [ctx.user.establishmentId, from, to])).rows;
  }

  async exportCsv(ctx: Ctx, raw: any) {
    const type = String(raw.type ?? '');
    const { from, to, event } = await this.range(raw);
    const brl = (c: number) => (c / 100).toFixed(2).replace('.', ',');
    let header: string[]; let rows: any[][];
    if (type === 'products') {
      const s = await this.summary(ctx, raw);
      header = ['Produto', 'Quantidade', 'Total (R$)']; rows = s.by_product.map((r: any) => [r.description, r.quantity, brl(r.total_cents)]);
    } else if (type === 'payments') {
      const r = await this.db.query(
        `SELECT p.created_at, t.number, p.method, p.status, p.amount_cents, p.reference FROM payments p JOIN tabs t ON t.id=p.tab_id
         WHERE t.establishment_id=$1 AND (p.created_at AT TIME ZONE ${TZ})::date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR t.event_id=$4) ORDER BY p.created_at`, [ctx.user.establishmentId, from, to, event]);
      header = ['Data', 'Comanda', 'Método', 'Situação', 'Valor (R$)', 'Referência']; rows = r.rows.map((x) => [x.created_at.toISOString(), x.number, x.method, x.status, brl(x.amount_cents), x.reference ?? '']);
    } else if (type === 'tabs') {
      const r = await this.db.query(
        `SELECT t.number, t.status, t.opened_at, t.closed_at, x.gross_cents, x.discount_cents, x.fee_cents, x.net_cents, x.paid_cents, x.balance_cents
         FROM tabs t CROSS JOIN LATERAL tab_totals(t.id) x WHERE t.establishment_id=$1 AND (t.opened_at AT TIME ZONE ${TZ})::date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR t.event_id=$4) ORDER BY t.opened_at`,
        [ctx.user.establishmentId, from, to, event]);
      header = ['Comanda', 'Situação', 'Abertura', 'Fechamento', 'Consumo (R$)', 'Descontos (R$)', 'Taxas (R$)', 'Líquido (R$)', 'Pago (R$)', 'Saldo (R$)'];
      rows = r.rows.map((x) => [x.number, x.status, x.opened_at.toISOString(), x.closed_at?.toISOString() ?? '', brl(x.gross_cents), brl(x.discount_cents), brl(x.fee_cents), brl(x.net_cents), brl(x.paid_cents), brl(x.balance_cents)]);
    } else throw badRequest('Tipo de exportação inválido (products, payments, tabs)', 'TIPO_INVALIDO');
    const esc = (v: any) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    await this.audit.log(null, ctx, { type: 'report.export', entity: 'report', entityId: type, after: { from, to, rows: rows.length } });
    return { filename: `${type}_${from}_${to}.csv`, body: '\ufeff' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n') };
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService) {}
  @Get('summary') @Roles('gerente', 'admin', 'auditor', 'supervisor') summary(@CurrentCtx() ctx: Ctx, @Query() q: any) { return this.svc.summary(ctx, q); }
  @Get('cash-closings') @Roles('gerente', 'admin', 'auditor', 'supervisor') cash(@CurrentCtx() ctx: Ctx, @Query() q: any) { return this.svc.cashClosings(ctx, q); }
  @Get('export') @Roles('gerente', 'admin')
  async export(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: any) {
    const f = await this.svc.exportCsv(ctx, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.send(f.body);
  }
}

@Module({ providers: [ReportsService], controllers: [ReportsController] })
export class ReportsModule {}
