import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ${name} não definida. Copie .env.example para .env.`);
  return v;
}
const dataKeyHex = required('DATA_KEY');
if (!/^[0-9a-fA-F]{64}$/.test(dataKeyHex)) throw new Error('DATA_KEY deve ter 64 caracteres hexadecimais (32 bytes).');
if (isProd && required('JWT_SECRET').length < 32) throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres em produção.');

export const env = {
  isProd,
  port: Number(process.env.PORT || 3001),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  dataKey: Buffer.from(dataKeyHex, 'hex'),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()),
};
