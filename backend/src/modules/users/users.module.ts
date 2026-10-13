import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService } from '../../common/database/database.service';
import { forbidden, notFound } from '../../common/errors/app-error';
import { parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';

const ROLES = ['admin', 'gerente', 'recepcao', 'atendente', 'caixa', 'supervisor', 'auditor'] as const;
const COLS = 'id, establishment_id, name, email, role, active, created_at';

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService, private audit: AuditService) {}

  async list(ctx: Ctx, q: any) {
    const est = ctx.user.role === 'admin' && q.establishment_id ? q.establishment_id : ctx.user.establishmentId;
    return (await this.db.query(`SELECT ${COLS} FROM users WHERE establishment_id=$1 ORDER BY active DESC, name`, [est])).rows;
  }

  async create(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({
      name: z.string().trim().min(2).max(120), email: z.string().email(), password: z.string().min(8).max(100),
      role: z.enum(ROLES), establishment_id: z.string().uuid().optional(),
    }), raw);
    if (ctx.user.role !== 'admin' && b.role === 'admin') throw forbidden('Somente administradores podem criar administradores');
    const est = ctx.user.role === 'admin' && b.establishment_id ? b.establishment_id : ctx.user.establishmentId;
    const u = (await this.db.query(`INSERT INTO users (establishment_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`,
      [est, b.name, b.email, await bcrypt.hash(b.password, 10), b.role])).rows[0];
    await this.audit.log(null, ctx, { type: 'user.create', entity: 'user', entityId: u.id, after: u, establishmentId: est });
    return u;
  }

  async update(ctx: Ctx, id: string, raw: unknown) {
    const b = parse(z.object({
      name: z.string().trim().min(2).max(120).optional(), role: z.enum(ROLES).optional(), active: z.boolean().optional(), password: z.string().min(8).max(100).optional(),
    }), raw);
    return this.db.tx(async (c) => {
      const old = (await c.query(`SELECT ${COLS} FROM users WHERE id=$1 AND establishment_id=$2 FOR UPDATE`, [id, ctx.user.establishmentId])).rows[0];
      if (!old) throw notFound('Usuário não encontrado');
      if (ctx.user.role !== 'admin' && (old.role === 'admin' || b.role === 'admin')) throw forbidden('Somente administradores podem alterar administradores');
      if (id === ctx.user.id && ((b.role && b.role !== old.role) || b.active === false)) throw forbidden('Você não pode alterar o próprio perfil nem se desativar');
      const u = (await c.query(
        `UPDATE users SET name=COALESCE($2,name), role=COALESCE($3,role), active=COALESCE($4,active), password_hash=COALESCE($5,password_hash) WHERE id=$1 RETURNING ${COLS}`,
        [id, b.name ?? null, b.role ?? null, b.active ?? null, b.password ? await bcrypt.hash(b.password, 10) : null])).rows[0];
      const permChange = b.role !== undefined && b.role !== old.role;
      await this.audit.log(c, ctx, { type: permChange ? 'user.permission_change' : b.password ? 'user.password_reset' : 'user.update', entity: 'user', entityId: id, before: old, after: u });
      return u;
    });
  }
}

@Controller('users')
@Roles('admin', 'gerente')
export class UsersController {
  constructor(private svc: UsersService) {}
  @Get() list(@CurrentCtx() ctx: Ctx, @Query() q: any) { return this.svc.list(ctx, q); }
  @Post() create(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.create(ctx, b); }
  @Patch(':id') update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.update(ctx, id, b); }
}

@Module({ providers: [UsersService], controllers: [UsersController] })
export class UsersModule {}
