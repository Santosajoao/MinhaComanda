import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type Role = 'admin' | 'gerente' | 'recepcao' | 'atendente' | 'caixa' | 'supervisor' | 'auditor';
export const ALL_ROLES: Role[] = ['admin', 'gerente', 'recepcao', 'atendente', 'caixa', 'supervisor', 'auditor'];
export interface AuthUser { id: string; name: string; role: Role; establishmentId: string; }
export interface Ctx { user: AuthUser; terminalId: string | null; requestId: string; }

export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const CurrentCtx = createParamDecorator((_d: unknown, ec: ExecutionContext): Ctx => {
  const r = ec.switchToHttp().getRequest();
  return { user: r.user, terminalId: r.terminalId ?? null, requestId: r.requestId };
});
export const ClientIp = createParamDecorator((_d: unknown, ec: ExecutionContext): string => ec.switchToHttp().getRequest().ip);
