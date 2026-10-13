import 'dotenv/config';
import { Client } from 'pg';
// Apaga TODO o schema public (apenas desenvolvimento).
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('db:reset não é permitido em produção');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('Schema public recriado (vazio).');
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
