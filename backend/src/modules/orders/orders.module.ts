import { Body, Controller, Get, Headers, HttpCode, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService } from '../../common/database/database.service';
import { badRequest, conflict, unprocessable } from '../../common/errors/app-error';
import { parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';
import { EFFECTIVE_PRICE } from '../catalog/catalog.module';
import { TabsModule } from '../tabs/tabs.module';
import { TabsService } from '../tabs/tabs.service';

export function requireKey(key: string | undefined): string {
  if (!key || key.length < 8 || key.length > 100) throw badRequest('Cabeçalho Idempotency-Key obrigatório (8 a 100 caracteres)', 'IDEMPOTENCY_KEY_OBRIGATORIA');
  return key;
}
const STATUS_MSG: Record<string, string> = {
  em_conferencia: 'A comanda está em conferência. Volte-a para aberta para lançar novos itens',
  aguardando_pagamento: 'A comanda está aguardando pagamento e não aceita novos lançamentos',
  parcialmente_paga: 'A comanda possui pagamentos e não aceita novos lançamentos',
  paga: 'A comanda já está paga e não aceita novos lançamentos',
  encerrada: 'A comanda está encerrada e não aceita novos lançamentos',
  bloqueada: 'A comanda está bloqueada', cancelada: 'A comanda foi cancelada',
};

@Injectable()
export class OrdersService {
  constructor(private db: DatabaseService, private audit: AuditService, private tabs: TabsService) {}

  async launch(ctx: Ctx, tabId: string, key: string | undefined, raw: unknown) {
    const k = requireKey(key);
    const b = parse(z.object({
      items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(999), note: z.string().trim().max(200).optional() })).min(1).max(50),
    }), raw);
    return this.db.tx(async (c) => {
      const tab = await this.tabs.lock(c, ctx, tabId);

      // RN-07: requisição repetida devolve o resultado já registrado, sem duplicar consumo.
      const prev = await c.query(
        `SELECT i.* FROM tab_items i JOIN tabs t ON t.id = i.tab_id WHERE i.batch_key=$1 AND t.establishment_id=$2 ORDER BY i.line_no`, [k, ctx.user.establishmentId]);
      if (prev.rows.length) {
        if (prev.rows[0].tab_id !== tabId) throw conflict('Esta chave de idempotência já foi usada em outra comanda', 'IDEMPOTENCIA_CONFLITO');
        return { replayed: true, items: prev.rows, tab: await this.tabs.view(c, ctx, tabId) };
      }
      if (tab.status !== 'aberta') throw conflict(STATUS_MSG[tab.status] ?? 'Comanda não está aberta', 'COMANDA_NAO_ABERTA');

      const ids = [...new Set(b.items.map((i) => i.product_id))];
      const prods = (await c.query(
        `SELECT p.id, p.name, p.category, p.sectors, ${EFFECTIVE_PRICE} AS price FROM products p WHERE p.id = ANY($1) AND p.establishment_id=$2 AND p.active`,
        [ids, ctx.user.establishmentId])).rows;
      const byId = new Map(prods.map((p) => [p.id, p]));
      let sector: string | null = null;
      if (ctx.terminalId) sector = (await c.query('SELECT sector FROM terminals WHERE id=$1', [ctx.terminalId])).rows[0]?.sector ?? null;
      for (const id of ids) {
        const p = byId.get(id);
        if (!p) throw unprocessable('Produto inexistente ou inativo', 'PRODUTO_INDISPONIVEL');
        if (sector && p.sectors.length && !p.sectors.includes(sector)) throw unprocessable(`"${p.name}" não está disponível neste ponto de venda`, 'PRODUTO_NAO_DISPONIVEL_NO_SETOR');
      }
      const out: any[] = [];
      let line = 0;
      for (const it of b.items) {
        const p = byId.get(it.product_id);
        // RN-05: o preço é o vigente no servidor no momento do lançamento; o cliente não envia preço.
        const row = (await c.query(
          `INSERT INTO tab_items (tab_id,product_id,description,category,quantity,unit_price_cents,subtotal_cents,note,batch_key,line_no,created_by,terminal_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [tabId, p.id, p.name, p.category, it.quantity, p.price, it.quantity * p.price, it.note ?? null, k, line++, ctx.user.id, ctx.terminalId])).rows[0];
        out.push(row);
      }
      await this.audit.log(c, ctx, { type: 'item.launch', entity: 'tab', entityId: tabId,
        after: out.map((r) => ({ id: r.id, description: r.description, quantity: r.quantity, unit_price_cents: r.unit_price_cents })) });
      return { replayed: false, items: out, tab: await this.tabs.view(c, ctx, tabId) };
    });
  }

  async list(ctx: Ctx, tabId: string, q: any) {
    await this.tabs.view(this.db, ctx, tabId);
    const w = ['i.tab_id = $1']; const p: any[] = [tabId];
    if (q.status) { p.push(q.status); w.push(`i.status = $${p.length}`); }
    if (q.product_id) { p.push(q.product_id); w.push(`i.product_id = $${p.length}`); }
    if (q.terminal_id) { p.push(q.terminal_id); w.push(`i.terminal_id = $${p.length}`); }
    if (q.from) { p.push(q.from); w.push(`i.created_at >= $${p.length}::timestamptz`); }
    if (q.to) { p.push(q.to); w.push(`i.created_at <= $${p.length}::timestamptz`); }
    const r = await this.db.query(
      `SELECT i.*, u.name AS created_by_name, tm.name AS terminal_name FROM tab_items i
       LEFT JOIN users u ON u.id=i.created_by LEFT JOIN terminals tm ON tm.id=i.terminal_id WHERE ${w.join(' AND ')} ORDER BY i.created_at, i.line_no`, p);
    return r.rows;
  }
}

@Controller('tabs/:id/items')
export class OrdersController {
  constructor(private svc: OrdersService) {}
  @Post() @HttpCode(200) @Roles('atendente', 'caixa', 'supervisor', 'gerente', 'admin')
  launch(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Headers('idempotency-key') key: string, @Body() b: unknown) { return this.svc.launch(ctx, id, key, b); }
  @Get() list(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) { return this.svc.list(ctx, id, q); }
}

@Module({ imports: [TabsModule], providers: [OrdersService], controllers: [OrdersController] })
export class OrdersModule {}
