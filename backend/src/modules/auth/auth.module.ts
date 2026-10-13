import { Body, Controller, Get, Global, HttpCode, Injectable, Module, Patch, Post } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { ClientIp, Ctx, CurrentCtx, Public, Role } from '../../common/authorization/context';
import { DatabaseService, Q } from '../../common/database/database.service';
import { AppError, forbidden } from '../../common/errors/app-error';
import { parse } from '../../common/validation/parse';
import { AuditService } from '../audit/audit.service';

export const ESTABLISHMENT_COLUMNS = `id, name, number_pad, number_mode, number_min, number_max, number_reuse, service_fee_bps,
  max_discount_bps, cpf_policy, allow_partial_payment`;

// Autorização adicional (RF-09): quem não tem o perfil exigido pode concluir a operação
// se um supervisor/gerente informar as próprias credenciais.
@Injectable()
export class ApprovalService {
  constructor(private db: DatabaseService, private audit: AuditService) {}
  async approve(q: Q, ctx: Ctx, allowed: Role[], approval: { email: string; password: string } | undefined, action: string) {
    if (allowed.includes(ctx.user.role)) return { approverId: ctx.user.id, role: ctx.user.role, self: true };
    if (!approval) throw new AppError(403, 'APROVACAO_NECESSARIA', `Esta operação exige autorização de: ${allowed.join(' / ')}`);
    const r = await q.query('SELECT id, password_hash, role, active, establishment_id FROM users WHERE lower(email) = lower($1)', [approval.email]);
    const u = r.rows[0];
    const ok = !!u && u.active && u.establishment_id === ctx.user.establishmentId && allowed.includes(u.role)
      && (await bcrypt.compare(approval.password, u.password_hash));
    if (!ok) {
      await this.audit.log(null, ctx, { type: 'auth.approval_denied', reason: action, after: { email: approval.email } });
      throw new AppError(403, 'APROVACAO_INVALIDA', 'Credenciais de aprovação inválidas ou sem permissão para esta operação');
    }
    return { approverId: u.id as string, role: u.role as Role, self: false };
  }
}

@Injectable()
export class AuthService {
  private attempts = new Map<string, { n: number; first: number }>();
  constructor(private db: DatabaseService, private audit: AuditService) {}

  private throttle(key: string) {
    const now = Date.now();
    const a = this.attempts.get(key);
    if (a && now - a.first > 15 * 60_000) this.attempts.delete(key);
    const cur = this.attempts.get(key);
    if (cur && cur.n >= 8) throw new AppError(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas de login. Aguarde alguns minutos');
  }
  private fail(key: string) {
    const a = this.attempts.get(key);
    if (a) a.n++; else this.attempts.set(key, { n: 1, first: Date.now() });
  }

  async login(raw: unknown, ip: string) {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), raw);
    const key = `${body.email.toLowerCase()}|${ip}`;
    this.throttle(key);
    const r = await this.db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [body.email]);
    const u = r.rows[0];
    const ok = !!u && u.active && (await bcrypt.compare(body.password, u.password_hash));
    if (!ok) {
      this.fail(key);
      await this.audit.log(null, null, { type: 'auth.login_failed', establishmentId: u?.establishment_id ?? null, after: { email: body.email, ip } });
      throw new AppError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha inválidos');
    }
    this.attempts.delete(key);
    const token = jwt.sign({ sub: u.id, role: u.role }, env.jwtSecret, { expiresIn: '10h' });
    await this.audit.log(null, null, { type: 'auth.login', userId: u.id, userName: u.name, establishmentId: u.establishment_id, entity: 'user', entityId: u.id });
    return { token, ...(await this.profile(u.id)) };
  }

  async profile(userId: string) {
    const u = (await this.db.query('SELECT id, name, email, role, establishment_id FROM users WHERE id=$1', [userId])).rows[0];
    const e = (await this.db.query(`SELECT ${ESTABLISHMENT_COLUMNS} FROM establishments WHERE id=$1`, [u.establishment_id])).rows[0];
    const cash = (await this.db.query(`SELECT * FROM cash_sessions WHERE user_id=$1 AND status='aberto'`, [userId])).rows[0] ?? null;
    return { user: { id: u.id, name: u.name, email: u.email, role: u.role, establishmentId: u.establishment_id }, establishment: e, cashSession: cash };
  }

  async changePassword(ctx: Ctx, raw: unknown) {
    const b = parse(z.object({ current_password: z.string().min(1), new_password: z.string().min(8).max(100) }), raw);
    const u = (await this.db.query('SELECT password_hash FROM users WHERE id=$1', [ctx.user.id])).rows[0];
    if (!(await bcrypt.compare(b.current_password, u.password_hash))) throw forbidden('Senha atual incorreta', 'SENHA_INCORRETA');
    await this.db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(b.new_password, 10), ctx.user.id]);
    await this.audit.log(null, ctx, { type: 'user.password_change', entity: 'user', entityId: ctx.user.id });
    return { ok: true };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private svc: AuthService) {}
  @Public() @Post('login') @HttpCode(200)
  login(@Body() body: unknown, @ClientIp() ip: string) { return this.svc.login(body, ip); }
  @Get('me') me(@CurrentCtx() ctx: Ctx) { return this.svc.profile(ctx.user.id); }
  @Patch('password') password(@CurrentCtx() ctx: Ctx, @Body() body: unknown) { return this.svc.changePassword(ctx, body); }
}

@Global()
@Module({ providers: [AuthService, ApprovalService], controllers: [AuthController], exports: [ApprovalService] })
export class AuthModule {}
