import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService, Q } from '../../common/database/database.service';
import { parse } from '../../common/validation/parse';

export interface AuditInput {
  type: string; entity?: string; entityId?: string | null; before?: unknown; after?: unknown; reason?: string | null;
  establishmentId?: string | null; userId?: string | null; userName?: string | null; terminalId?: string | null; requestId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private db: DatabaseService) {}
  // Passe o client da transação para que o evento seja gravado atomicamente com a operação.
  async log(q: Q | null, ctx: Ctx | null, e: AuditInput) {
    await (q ?? this.db).query(
      `INSERT INTO audit_events (establishment_id,user_id,user_name,terminal_id,type,entity,entity_id,before,after,reason,request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [e.establishmentId ?? ctx?.user.establishmentId ?? null, e.userId ?? ctx?.user.id ?? null, e.userName ?? ctx?.user.name ?? null,
        e.terminalId ?? ctx?.terminalId ?? null, e.type, e.entity ?? null, e.entityId ?? null,
        e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after),
        e.reason ?? null, e.requestId ?? ctx?.requestId ?? null],
    );
  }
  async list(ctx: Ctx, raw: unknown) {
    const f = parse(z.object({
      type: z.string().optional(), user_id: z.string().uuid().optional(), entity_id: z.string().optional(),
      from: z.string().optional(), to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100), before_id: z.coerce.number().int().optional(),
    }), raw);
    const w = ['establishment_id = $1']; const p: any[] = [ctx.user.establishmentId];
    const add = (cond: string, v: any) => { p.push(v); w.push(cond.replace('?', `$${p.length}`)); };
    if (f.type) add('type LIKE ?', `${f.type}%`);
    if (f.user_id) add('user_id = ?', f.user_id);
    if (f.entity_id) add('entity_id = ?', f.entity_id);
    if (f.from) add('created_at >= ?::timestamptz', f.from);
    if (f.to) add("created_at < (?::date + 1)::timestamptz", f.to);
    if (f.before_id) add('id < ?', f.before_id);
    p.push(f.limit);
    const r = await this.db.query(`SELECT * FROM audit_events WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT $${p.length}`, p);
    return r.rows;
  }
}

@Controller('audit-events')
export class AuditController {
  constructor(private svc: AuditService) {}
  @Get() @Roles('gerente', 'admin', 'auditor')
  list(@CurrentCtx() ctx: Ctx, @Query() q: any) { return this.svc.list(ctx, q); }
}

@Global()
@Module({ providers: [AuditService], controllers: [AuditController], exports: [AuditService] })
export class AuditModule {}
