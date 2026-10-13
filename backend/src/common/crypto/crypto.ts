import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { env } from '../../config/env';

// CPF é armazenado criptografado (AES-256-GCM); o HMAC permite localizar por CPF sem expor o valor.
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', env.dataKey, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  const d = createDecipheriv('aes-256-gcm', env.dataKey, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
export function hashCpf(establishmentId: string, cpfDigits: string): string {
  return createHmac('sha256', env.dataKey).update(`${establishmentId}:${cpfDigits}`).digest('hex');
}
