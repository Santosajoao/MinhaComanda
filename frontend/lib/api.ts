export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const getToken = () => (typeof window === 'undefined' ? null : localStorage.getItem('token'));
export const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const terminal = typeof window !== 'undefined' ? localStorage.getItem('terminalId') : null;
  if (terminal) headers['X-Terminal-Id'] = terminal;
  if (opts.key) headers['Idempotency-Key'] = opts.key;
  let res: Response;
  try {
    res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'SEM_CONEXAO', 'Sem conexão com o servidor. A operação pode não ter sido concluída: confira antes de repetir.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
      localStorage.removeItem('token');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    throw new ApiError(res.status, data?.error?.code ?? 'ERRO', data?.error?.message ?? `Erro ${res.status}`);
  }
  return data as T;
}

export async function download(path: string, filename: string) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'ERRO', 'Falha ao exportar');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

export const money = (c: number | null | undefined) => ((c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function parseMoney(s: string): number {
  const n = parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '—');
export const STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta', em_conferencia: 'Em conferência', aguardando_pagamento: 'Aguardando pagamento', parcialmente_paga: 'Parcialmente paga',
  paga: 'Paga', encerrada: 'Encerrada', bloqueada: 'Bloqueada', cancelada: 'Cancelada',
  pendente: 'Pendente', confirmado: 'Confirmado', recusado: 'Recusado', cancelado: 'Cancelado', estornado: 'Estornado', valido: 'Válido',
};
export const METHOD_LABEL: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', outro: 'Outro' };
export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador', gerente: 'Gerente', recepcao: 'Recepção', atendente: 'Atendente/Garçom', caixa: 'Caixa', supervisor: 'Supervisor', auditor: 'Auditor',
};
