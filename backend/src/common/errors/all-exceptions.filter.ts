import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ZodError } from 'zod';
import { AppError } from './app-error';

const CONSTRAINTS: Record<string, [string, string]> = {
  uq_tabs_active_number: ['COMANDA_OCUPADA', 'Já existe uma comanda ativa com este número'],
  uq_consumers_cpf: ['CPF_DUPLICADO', 'Já existe um consumidor com este CPF'],
  uq_cash_open_per_user: ['CAIXA_JA_ABERTO', 'Você já possui um caixa aberto'],
  uq_users_email: ['EMAIL_EM_USO', 'Este e-mail já está cadastrado'],
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(ex: any, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();
    let status = 500;
    let code = 'ERRO_INTERNO';
    let message = 'Erro interno do servidor';
    let details: unknown;

    if (ex instanceof AppError) {
      ({ status, code, message, details } = ex);
    } else if (ex instanceof ZodError) {
      status = 400;
      code = 'VALIDACAO';
      message = ex.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; ');
      details = ex.issues;
    } else if (ex instanceof HttpException) {
      status = ex.getStatus();
      const r: any = ex.getResponse();
      message = typeof r === 'string' ? r : Array.isArray(r?.message) ? r.message.join('; ') : r?.message ?? ex.message;
      code = status === 404 ? 'NAO_ENCONTRADO' : status === 401 ? 'NAO_AUTENTICADO' : 'ERRO_HTTP';
    } else if (ex?.type === 'entity.parse.failed') {
      status = 400; code = 'JSON_INVALIDO'; message = 'Corpo da requisição não é um JSON válido';
    } else if (typeof ex?.code === 'string') {
      switch (ex.code) {
        case '23505': {
          const [c, m] = CONSTRAINTS[ex.constraint] ?? ['CONFLITO', 'Registro duplicado'];
          status = 409; code = c; message = m; break;
        }
        case 'P0001': status = 409; code = 'REGRA_DE_NEGOCIO'; message = ex.message; break;
        case '22P02': status = 400; code = 'DADO_INVALIDO'; message = 'Identificador ou valor em formato inválido'; break;
        case '23503': status = 409; code = 'REFERENCIA_INVALIDA'; message = 'Registro referenciado inexistente ou em uso'; break;
        case '23514': status = 422; code = 'RESTRICAO_VIOLADA'; message = 'Valor fora das regras permitidas'; break;
        case '40P01':
        case '40001': status = 503; code = 'TENTE_NOVAMENTE'; message = 'Conflito de concorrência, tente novamente'; break;
      }
    }
    if (status >= 500) console.error(JSON.stringify({ level: 'error', requestId: req?.requestId, message: ex?.message, stack: ex?.stack }));
    res.status(status).json({ error: { code, message, details, requestId: req?.requestId } });
  }
}
