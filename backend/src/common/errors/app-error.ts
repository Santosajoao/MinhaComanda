export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (msg = 'Registro não encontrado') => new AppError(404, 'NAO_ENCONTRADO', msg);
export const badRequest = (msg: string, code = 'REQUISICAO_INVALIDA', details?: unknown) => new AppError(400, code, msg, details);
export const conflict = (msg: string, code = 'CONFLITO') => new AppError(409, code, msg);
export const forbidden = (msg = 'Sem permissão para esta operação', code = 'SEM_PERMISSAO') => new AppError(403, code, msg);
export const unprocessable = (msg: string, code = 'REGRA_DE_NEGOCIO') => new AppError(422, code, msg);
