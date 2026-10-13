import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService } from '../../common/database/database.service';
import { conflict, notFound, unprocessable } from '../../common/errors/app-error';
import { parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';
import { ESTABLISHMENT_COLUMNS } from '../auth/auth.module';

const settings = z.object({
  name: z.string().trim().min(2).max(120), number_pad: z.number().int().min(1).max(12), number_mode: z.enum(['auto', 'manual']),
  number_min: z.number().int().min(0).max(99_999_999), number_max: z.number().int().min(1).max(99_999_999), number_reuse: z.boolean(),
  service_fee_bps: z.number().int().min(0).max(3000), max_discount_bps: z.number().int().min(0).max(10000),
  cpf_policy: z.enum(['required', 'optional', 'none']), allow_partial_payment: z.boolean(),
});

@Injectable()
export class EstablishmentsService {
  constructor(private db: DatabaseService, private audit: AuditService) {}

  async get(ctx: Ctx) {
    return (await this.db.query(`SELECT ${ESTABLISHMENT_COLUMNS} FROM establishments WHERE id=$1`, [ctx.user.establishmentId])).rows[0];
  }

  async update(ctx: Ctx, raw: unknown) {
    const b: any = parse(settings.partial(), raw);
    return this.db.tx(async (c) => {
      const old = (await c.query(`SELECT ${ESTABLISHMENT_COLUMNS} FROM establishments WHERE id=$1 FOR UPDATE`, [ctx.user.establishmentId])).rows[0];
      const n = { ...old, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
      if (n.number_min > n.number_max) throw unprocessable('A faixa de numeração é inválida (mínimo maior que o máximo)', 'FAIXA_INVALIDA');
      const r = (await c.query(
        `UPDATE establishments SET name=$2,number_pad=$3,number_mode=$4,number_min=$5,number_max=$6,number_reuse=$7,service_fee_bps=$8,max_discount_bps=$9,cpf_policy=$10,allow_partial_payment=$11
         WHERE id=$1 RETURNING ${ESTABLISHMENT_COLUMNS}`,
        [old.id, n.name, n.number_pad, n.number_mode, n.number_min, n.number_max, n.number_reuse, n.service_fee_bps, n.max_discount_bps, n.cpf_policy, n.allow_partial_payment])).rows[0];
      await this.audit.log(c, ctx, { type: 'establishment.update', entity: 'establishment', entityId: old.id, before: old, after: r });
      return r;
    });
  }

  listAll() { return this.db.query('SELECT id, name, created_at FROM establishments ORDER BY name').then((r) => r.rows); }

  async createEstablishment(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({ name: z.string().trim().min(2).max(120), manager: z.object({ name: z.string().trim().min(2), email: z.string().email(), password: z.string().min(8) }) }), raw);
    return this.db.tx(async (c) => {
      const e = (await c.query('INSERT INTO establishments (name) VALUES ($1) RETURNING id, name', [b.name])).rows[0];
      await c.query(`INSERT INTO users (establishment_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,'gerente')`, [e.id, b.manager.name, b.manager.email, await bcrypt.hash(b.manager.password, 10)]);
      await c.query(`INSERT INTO terminals (establishment_id,name,sector) VALUES ($1,'Caixa 1','caixa')`, [e.id]);
      await this.audit.log(c, ctx, { type: 'establishment.create', entity: 'establishment', entityId: e.id, after: { name: e.name, manager_email: b.manager.email } });
      return e;
    });
  }

  // ----- eventos -----
  events(ctx: Ctx) { return this.db.query('SELECT * FROM events WHERE establishment_id=$1 ORDER BY starts_at DESC LIMIT 100', [ctx.user.establishmentId]).then((r) => r.rows); }

  async createEvent(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({ name: z.string().trim().min(2).max(120) }), raw);
    return this.db.tx(async (c) => {
      const e = (await c.query('INSERT INTO events (establishment_id,name) VALUES ($1,$2) RETURNING *', [ctx.user.establishmentId, b.name])).rows[0];
      await this.audit.log(c, ctx, { type: 'event.create', entity: 'event', entityId: e.id, after: e });
      return e;
    });
  }

  async closeEvent(ctx: Ctx, id: string) {
    return this.db.tx(async (c) => {
      const e = (await c.query('SELECT * FROM events WHERE id=$1 AND establishment_id=$2 FOR UPDATE', [id, ctx.user.establishmentId])).rows[0];
      if (!e) throw notFound('Evento não encontrado');
      if (e.status === 'encerrado') throw conflict('Evento já encerrado', 'ESTADO_INVALIDO');
      const open = (await c.query(`SELECT COUNT(*)::int AS n FROM tabs WHERE event_id=$1 AND status NOT IN ('encerrada','cancelada')`, [id])).rows[0].n;
      if (open > 0) throw conflict(`Existem ${open} comanda(s) ainda ativas neste evento. Encerre-as antes`, 'EVENTO_COM_COMANDAS_ATIVAS');
      const r = (await c.query(`UPDATE events SET status='encerrado', ends_at=now() WHERE id=$1 RETURNING *`, [id])).rows[0];
      await this.audit.log(c, ctx, { type: 'event.close', entity: 'event', entityId: id });
      return r;
    });
  }

  // ----- terminais / pontos de venda -----
  terminals(ctx: Ctx) { return this.db.query('SELECT * FROM terminals WHERE establishment_id=$1 ORDER BY name', [ctx.user.establishmentId]).then((r) => r.rows); }

  async createTerminal(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({ name: z.string().trim().min(2).max(60), sector: z.string().trim().min(2).max(40).default('geral') }), raw);
    const t = (await this.db.query('INSERT INTO terminals (establishment_id,name,sector) VALUES ($1,$2,$3) RETURNING *', [ctx.user.establishmentId, b.name, b.sector])).rows[0];
    await this.audit.log(null, ctx, { type: 'terminal.create', entity: 'terminal', entityId: t.id, after: t });
    return t;
  }

  async updateTerminal(ctx: Ctx, id: string, raw: unknown) {
    const b: any = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), sector: z.string().trim().min(2).max(40).optional(), active: z.boolean().optional() }), raw);
    const t = (await this.db.query('UPDATE terminals SET name=COALESCE($3,name), sector=COALESCE($4,sector), active=COALESCE($5,active) WHERE id=$1 AND establishment_id=$2 RETURNING *',
      [id, ctx.user.establishmentId, b.name ?? null, b.sector ?? null, b.active ?? null])).rows[0];
    if (!t) throw notFound('Terminal não encontrado');
    await this.audit.log(null, ctx, { type: 'terminal.update', entity: 'terminal', entityId: id, after: t });
    return t;
  }
}

@Controller()
export class EstablishmentsController {
  constructor(private svc: EstablishmentsService) {}
  @Get('establishment') get(@CurrentCtx() ctx: Ctx) { return this.svc.get(ctx); }
  @Patch('establishment') @Roles('admin', 'gerente') update(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.update(ctx, b); }
  @Get('admin/establishments') @Roles('admin') listAll() { return this.svc.listAll(); }
  @Post('admin/establishments') @Roles('admin') create(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.createEstablishment(ctx, b); }
  @Get('events') events(@CurrentCtx() ctx: Ctx) { return this.svc.events(ctx); }
  @Post('events') @Roles('admin', 'gerente') createEvent(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.createEvent(ctx, b); }
  @Post('events/:id/close') @HttpCode(200) @Roles('admin', 'gerente') closeEvent(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.svc.closeEvent(ctx, id); }
  @Get('terminals') terminals(@CurrentCtx() ctx: Ctx) { return this.svc.terminals(ctx); }
  @Post('terminals') @Roles('admin', 'gerente') createTerminal(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.createTerminal(ctx, b); }
  @Patch('terminals/:id') @Roles('admin', 'gerente') updateTerminal(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.updateTerminal(ctx, id, b); }
}

@Module({ providers: [EstablishmentsService], controllers: [EstablishmentsController] })
export class EstablishmentsModule {}
