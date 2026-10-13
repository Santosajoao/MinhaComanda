import { ZodTypeAny, z } from 'zod';
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data ?? {});
}
export const uuid = z.string().uuid();
export const approvalSchema = z.object({ email: z.string().email(), password: z.string().min(1) }).optional();
export const reasonSchema = z.string().trim().min(3, 'Informe o motivo (mínimo 3 caracteres)').max(300);
export const cents = z.number().int().min(0).max(100_000_000);
