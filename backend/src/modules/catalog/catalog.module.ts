import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService } from '../../common/database/database.service';
import { notFound } from '../../common/errors/app-error';
import { cents, parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';

// Preço vigente: promoção só vale dentro da vigência configurada.
export const EFFECTIVE_PRICE = `CASE WHEN p.promo_price_cents IS NOT NULL AND now() BETWEEN p.promo_starts_at AND p.promo_ends_at THEN p.promo_price_cents ELSE p.price_cents END`;

const productSchema = z.object({
  code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(120), category: z.string().trim().min(1).max(60).default('Geral'),
  unit: z.string().trim().min(1).max(10).default('un'), price_cents: cents, active: z.boolean().default(true),
  sectors: z.array(z.string().trim().min(1)).default([]),
  promo_price_cents: cents.nullable().optional(), promo_starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  promo_ends_at: z.string().datetime({ offset: true }).nullable().optional(),
});
const promoCheck = (b: any) => {
  if (b.promo_price_cents != null && (!b.promo_starts_at || !b.promo_ends_at)) throw new z.ZodError([{ code: 'custom', path: ['promo_starts_at'], message: 'Informe início e fim da vigência da promoção' }]);
};

@Injectable()
export class CatalogService {
  constructor(private db: DatabaseService, private audit: AuditService) {}

  private map(r: any) {
    return { ...r, effective_price_cents: r.effective_price_cents, promo_active: r.effective_price_cents !== r.price_cents || (r.promo_price_cents != null && r.promo_price_cents === r.price_cents && r.promo_now) };
  }

  async list(ctx: Ctx, q: any) {
    const w = ['p.establishment_id = $1']; const p: any[] = [ctx.user.establishmentId];
    if (q.active === 'true') w.push('p.active');
    if (q.category) { p.push(q.category); w.push(`p.category = $${p.length}`); }
    if (q.q) { p.push(`%${String(q.q).trim()}%`); w.push(`(p.name ILIKE $${p.length} OR p.code ILIKE $${p.length})`); }
    if (q.for_terminal === 'true' && ctx.terminalId) {
      p.push(ctx.terminalId);
      w.push(`(cardinality(p.sectors) = 0 OR (SELECT sector FROM terminals WHERE id = $${p.length}) = ANY(p.sectors))`);
    }
    const r = await this.db.query(
      `SELECT p.*, ${EFFECTIVE_PRICE} AS effective_price_cents,
              (p.promo_price_cents IS NOT NULL AND now() BETWEEN p.promo_starts_at AND p.promo_ends_at) AS promo_now
       FROM products p WHERE ${w.join(' AND ')} ORDER BY p.category, p.name`, p);
    return r.rows.map((x) => this.map(x));
  }

  async categories(ctx: Ctx) {
    const r = await this.db.query('SELECT DISTINCT category FROM products WHERE establishment_id=$1 AND active ORDER BY category', [ctx.user.establishmentId]);
    return r.rows.map((x) => x.category);
  }

  async create(ctx: Ctx, raw: unknown) {
    const b = parse(productSchema, raw); promoCheck(b);
    return this.db.tx(async (c) => {
      const r = (await c.query(
        `INSERT INTO products (establishment_id,code,name,category,unit,price_cents,active,sectors,promo_price_cents,promo_starts_at,promo_ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [ctx.user.establishmentId, b.code, b.name, b.category, b.unit, b.price_cents, b.active, b.sectors, b.promo_price_cents ?? null, b.promo_starts_at ?? null, b.promo_ends_at ?? null])).rows[0];
      await c.query('INSERT INTO product_prices (product_id,price_cents,promo_price_cents,promo_starts_at,promo_ends_at,changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.id, r.price_cents, r.promo_price_cents, r.promo_starts_at, r.promo_ends_at, ctx.user.id]);
      await this.audit.log(c, ctx, { type: 'product.create', entity: 'product', entityId: r.id, after: r });
      return r;
    });
  }

  async update(ctx: Ctx, id: string, raw: unknown) {
    const b: any = parse(productSchema.partial(), raw);
    return this.db.tx(async (c) => {
      const old = (await c.query('SELECT * FROM products WHERE id=$1 AND establishment_id=$2 FOR UPDATE', [id, ctx.user.establishmentId])).rows[0];
      if (!old) throw notFound('Produto não encontrado');
      const n = { ...old, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
      promoCheck(n);
      const r = (await c.query(
        `UPDATE products SET code=$2,name=$3,category=$4,unit=$5,price_cents=$6,active=$7,sectors=$8,promo_price_cents=$9,promo_starts_at=$10,promo_ends_at=$11 WHERE id=$1 RETURNING *`,
        [id, n.code, n.name, n.category, n.unit, n.price_cents, n.active, n.sectors, n.promo_price_cents ?? null, n.promo_starts_at ?? null, n.promo_ends_at ?? null])).rows[0];
      const priceChanged = r.price_cents !== old.price_cents || r.promo_price_cents !== old.promo_price_cents
        || String(r.promo_starts_at) !== String(old.promo_starts_at) || String(r.promo_ends_at) !== String(old.promo_ends_at);
      if (priceChanged) {
        await c.query('INSERT INTO product_prices (product_id,price_cents,promo_price_cents,promo_starts_at,promo_ends_at,changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, r.price_cents, r.promo_price_cents, r.promo_starts_at, r.promo_ends_at, ctx.user.id]);
      }
      await this.audit.log(c, ctx, { type: priceChanged ? 'product.price_change' : 'product.update', entity: 'product', entityId: id, before: old, after: r });
      return r;
    });
  }

  async prices(ctx: Ctx, id: string) {
    const r = await this.db.query(
      `SELECT pp.*, u.name AS changed_by_name FROM product_prices pp JOIN products p ON p.id = pp.product_id
       LEFT JOIN users u ON u.id = pp.changed_by WHERE pp.product_id=$1 AND p.establishment_id=$2 ORDER BY pp.id DESC`, [id, ctx.user.establishmentId]);
    return r.rows;
  }
}

@Controller('products')
export class CatalogController {
  constructor(private svc: CatalogService) {}
  @Get() list(@CurrentCtx() ctx: Ctx, @Query() q: any) { return this.svc.list(ctx, q); }
  @Get('categories') categories(@CurrentCtx() ctx: Ctx) { return this.svc.categories(ctx); }
  @Post() @Roles('gerente', 'admin') create(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.create(ctx, b); }
  @Patch(':id') @Roles('gerente', 'admin') update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.update(ctx, id, b); }
  @Get(':id/prices') @Roles('gerente', 'admin', 'auditor') prices(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.svc.prices(ctx, id); }
}

@Module({ providers: [CatalogService], controllers: [CatalogController] })
export class CatalogModule {}
