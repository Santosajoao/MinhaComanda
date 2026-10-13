import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { DatabaseService, Q } from '../../common/database/database.service';
import { badRequest, notFound } from '../../common/errors/app-error';
import { decrypt, encrypt, hashCpf } from '../../common/crypto/crypto';
import { isValidCpf, maskCpf, onlyDigits } from '../../common/validation/cpf';
import { parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';

const OPERATIONAL: any[] = ['recepcao', 'caixa', 'supervisor', 'gerente', 'admin'];

@Injectable()
export class ConsumersService {
  constructor(private db: DatabaseService, private audit: AuditService) {}

  mapRow(r: any, reveal = false) {
    return {
      id: r.id, name: r.name, cpf_masked: r.cpf_enc ? maskCpf(decrypt(r.cpf_enc)) : null,
      ...(reveal && r.cpf_enc ? { cpf: decrypt(r.cpf_enc) } : {}), created_at: r.created_at,
    };
  }

  // Resolve (ou cria) o cadastro do consumidor na abertura da comanda — RF-01.
  async resolve(c: Q, ctx: Ctx, est: any, b: { consumer_id?: string; name?: string; cpf?: string }): Promise<string> {
    const policy: string = est.cpf_policy;
    const cpf = policy === 'none' ? '' : onlyDigits(b.cpf ?? '');
    if (cpf && !isValidCpf(cpf)) throw badRequest('CPF inválido', 'CPF_INVALIDO');
    if (b.consumer_id) {
      const row = (await c.query('SELECT * FROM consumers WHERE id=$1 AND establishment_id=$2', [b.consumer_id, est.id])).rows[0];
      if (!row) throw notFound('Consumidor não encontrado');
      if (policy === 'required' && !row.cpf_hash && !cpf) throw badRequest('CPF obrigatório neste estabelecimento', 'CPF_OBRIGATORIO');
      if (cpf && !row.cpf_hash) {
        await c.query('UPDATE consumers SET cpf_enc=$1, cpf_hash=$2, updated_at=now() WHERE id=$3', [encrypt(cpf), hashCpf(est.id, cpf), row.id]);
      }
      return row.id;
    }
    const name = (b.name ?? '').trim();
    if (name.length < 2) throw badRequest('Informe o nome do consumidor', 'NOME_OBRIGATORIO');
    if (policy === 'required' && !cpf) throw badRequest('CPF obrigatório neste estabelecimento', 'CPF_OBRIGATORIO');
    if (cpf) {
      const h = hashCpf(est.id, cpf);
      const ex = (await c.query('SELECT id FROM consumers WHERE establishment_id=$1 AND cpf_hash=$2', [est.id, h])).rows[0];
      if (ex) return ex.id; // consumidor recorrente
      return (await c.query('INSERT INTO consumers (establishment_id,name,cpf_enc,cpf_hash) VALUES ($1,$2,$3,$4) RETURNING id', [est.id, name, encrypt(cpf), h])).rows[0].id;
    }
    return (await c.query('INSERT INTO consumers (establishment_id,name) VALUES ($1,$2) RETURNING id', [est.id, name])).rows[0].id;
  }

  async create(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({ name: z.string().trim().min(2).max(120), cpf: z.string().optional() }), raw);
    return this.db.tx(async (c) => {
      const est = (await c.query('SELECT * FROM establishments WHERE id=$1', [ctx.user.establishmentId])).rows[0];
      const id = await this.resolve(c, ctx, est, b);
      await this.audit.log(c, ctx, { type: 'consumer.create', entity: 'consumer', entityId: id, after: { name: b.name, cpf_informado: !!b.cpf } });
      return this.mapRow((await c.query('SELECT * FROM consumers WHERE id=$1', [id])).rows[0]);
    });
  }

  async get(ctx: Ctx, id: string, reveal: boolean) {
    const r = (await this.db.query('SELECT * FROM consumers WHERE id=$1 AND establishment_id=$2', [id, ctx.user.establishmentId])).rows[0];
    if (!r) throw notFound('Consumidor não encontrado');
    const canReveal = reveal && ['gerente', 'admin'].includes(ctx.user.role);
    if (canReveal) await this.audit.log(null, ctx, { type: 'consumer.cpf_reveal', entity: 'consumer', entityId: id });
    const tabs = (await this.db.query('SELECT id, number, status, opened_at FROM tabs WHERE consumer_id=$1 ORDER BY opened_at DESC LIMIT 20', [id])).rows;
    return { ...this.mapRow(r, canReveal), tabs };
  }

  async search(ctx: Ctx, q: any) {
    const term = String(q.q ?? '').trim();
    if (term.length < 2) return [];
    const digits = onlyDigits(term);
    const r = await this.db.query(
      `SELECT * FROM consumers WHERE establishment_id=$1 AND (name ILIKE $2 OR ($3 <> '' AND cpf_hash = $4)) ORDER BY name LIMIT 30`,
      [ctx.user.establishmentId, `%${term}%`, digits.length === 11 ? '1' : '', digits.length === 11 ? hashCpf(ctx.user.establishmentId, digits) : '']);
    return r.rows.map((x) => this.mapRow(x));
  }

  async update(ctx: Ctx, id: string, raw: unknown) {
    const b = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), cpf: z.string().nullable().optional(), reason: z.string().trim().min(3).max(300) }), raw);
    return this.db.tx(async (c) => {
      const old = (await c.query('SELECT * FROM consumers WHERE id=$1 AND establishment_id=$2 FOR UPDATE', [id, ctx.user.establishmentId])).rows[0];
      if (!old) throw notFound('Consumidor não encontrado');
      const est = (await c.query('SELECT cpf_policy FROM establishments WHERE id=$1', [ctx.user.establishmentId])).rows[0];
      let enc = old.cpf_enc, hash = old.cpf_hash;
      if (b.cpf !== undefined) {
        const d = onlyDigits(b.cpf ?? '');
        if (!d) {
          if (est.cpf_policy === 'required') throw badRequest('CPF obrigatório neste estabelecimento', 'CPF_OBRIGATORIO');
          enc = null; hash = null;
        } else {
          if (!isValidCpf(d)) throw badRequest('CPF inválido', 'CPF_INVALIDO');
          enc = encrypt(d); hash = hashCpf(ctx.user.establishmentId, d);
        }
      }
      await c.query('UPDATE consumers SET name=$1, cpf_enc=$2, cpf_hash=$3, updated_at=now() WHERE id=$4', [b.name ?? old.name, enc, hash, id]);
      const fresh = (await c.query('SELECT * FROM consumers WHERE id=$1', [id])).rows[0];
      await this.audit.log(c, ctx, { type: 'consumer.update', entity: 'consumer', entityId: id, reason: b.reason, before: this.mapRow(old), after: this.mapRow(fresh) });
      return this.mapRow(fresh);
    });
  }
}

@Controller('consumers')
export class ConsumersController {
  constructor(private svc: ConsumersService) {}
  @Post() @Roles(...OPERATIONAL) create(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.create(ctx, b); }
  @Get() @Roles(...OPERATIONAL) search(@CurrentCtx() ctx: Ctx, @Query() q: any) { return this.svc.search(ctx, q); }
  @Get(':id') @Roles(...OPERATIONAL, 'auditor') get(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('reveal') reveal?: string) { return this.svc.get(ctx, id, reveal === 'true'); }
  @Patch(':id') @Roles(...OPERATIONAL) update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.update(ctx, id, b); }
}

@Module({ providers: [ConsumersService], controllers: [ConsumersController], exports: [ConsumersService] })
export class ConsumersModule {}
