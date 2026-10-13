import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { DatabaseService } from '../database/database.service';
import { AppError } from '../errors/app-error';
import { Role } from './context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Autenticação + autorização por perfil, sempre no servidor (RF-09).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: DatabaseService) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [ec.getHandler(), ec.getClass()]);
    if (isPublic) return true;
    const req = ec.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError(401, 'NAO_AUTENTICADO', 'Faça login para continuar');
    let payload: any;
    try { payload = jwt.verify(token, env.jwtSecret); }
    catch { throw new AppError(401, 'SESSAO_EXPIRADA', 'Sessão inválida ou expirada. Faça login novamente'); }

    const r = await this.db.query('SELECT id, name, role, establishment_id, active FROM users WHERE id = $1', [payload.sub]);
    const u = r.rows[0];
    if (!u || !u.active) throw new AppError(401, 'USUARIO_INATIVO', 'Usuário inativo ou inexistente');
    req.user = { id: u.id, name: u.name, role: u.role as Role, establishmentId: u.establishment_id };

    const t = req.headers['x-terminal-id'];
    if (t) {
      if (typeof t !== 'string' || !UUID.test(t)) throw new AppError(400, 'TERMINAL_INVALIDO', 'Terminal inválido');
      const tr = await this.db.query('SELECT 1 FROM terminals WHERE id=$1 AND establishment_id=$2 AND active', [t, u.establishment_id]);
      if (!tr.rowCount) throw new AppError(400, 'TERMINAL_INVALIDO', 'Terminal inexistente ou inativo neste estabelecimento');
      req.terminalId = t;
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>('roles', [ec.getHandler(), ec.getClass()]);
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new AppError(403, 'SEM_PERMISSAO', 'Seu perfil não tem permissão para esta operação');
    }
    return true;
  }
}
