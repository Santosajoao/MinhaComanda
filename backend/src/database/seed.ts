import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { Client } from 'pg';

const PASSWORD = 'Senha@123';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const exists = await c.query('SELECT 1 FROM establishments LIMIT 1');
  if (exists.rowCount) { console.log('Banco já possui dados; seed ignorado.'); await c.end(); return; }
  await c.query('BEGIN');
  const e = (await c.query(`INSERT INTO establishments (name, number_mode, number_min, number_max, number_pad, max_discount_bps)
    VALUES ('Boate Exemplo', 'auto', 1, 1000, 5, 1000) RETURNING id`)).rows[0];
  const hash = await bcrypt.hash(PASSWORD, 10);
  const users: [string, string, string][] = [
    ['Ana Administradora', 'admin@exemplo.com', 'admin'], ['Gustavo Gerente', 'gerente@exemplo.com', 'gerente'],
    ['Rita Recepção', 'recepcao@exemplo.com', 'recepcao'], ['Beto Garçom', 'atendente@exemplo.com', 'atendente'],
    ['Cláudia Caixa', 'caixa@exemplo.com', 'caixa'], ['Sérgio Supervisor', 'supervisor@exemplo.com', 'supervisor'],
    ['Augusto Auditor', 'auditor@exemplo.com', 'auditor'],
  ];
  for (const [name, email, role] of users) {
    await c.query('INSERT INTO users (establishment_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)', [e.id, name, email, hash, role]);
  }
  for (const [name, sector] of [['Recepção', 'recepcao'], ['Bar 1', 'bar'], ['Bar 2', 'bar'], ['Cozinha', 'cozinha'], ['Caixa 1', 'caixa']]) {
    await c.query('INSERT INTO terminals (establishment_id,name,sector) VALUES ($1,$2,$3)', [e.id, name, sector]);
  }
  await c.query(`INSERT INTO events (establishment_id,name) VALUES ($1,'Noite de Sábado')`, [e.id]);
  const products: [string, string, string, number][] = [
    ['CERV01', 'Cerveja Long Neck', 'Cervejas', 1500], ['CERV02', 'Cerveja 600ml', 'Cervejas', 2200], ['CERV03', 'Chopp 300ml', 'Cervejas', 1200],
    ['DRK01', 'Caipirinha', 'Drinks', 2400], ['DRK02', 'Gin Tônica', 'Drinks', 3200], ['DRK03', 'Vodka com Energético', 'Drinks', 2800],
    ['DRK04', 'Whisky Dose', 'Drinks', 3500], ['SA01', 'Água Mineral', 'Sem álcool', 600], ['SA02', 'Refrigerante Lata', 'Sem álcool', 800],
    ['SA03', 'Energético', 'Sem álcool', 1500], ['SA04', 'Suco Natural', 'Sem álcool', 1200], ['POR01', 'Porção de Fritas', 'Porções', 3800],
    ['POR02', 'Porção de Frango', 'Porções', 4800], ['POR03', 'Porção de Calabresa', 'Porções', 4200], ['OUT01', 'Cigarro Maço', 'Outros', 2000],
  ];
  for (const [code, name, cat, price] of products) {
    const p = (await c.query('INSERT INTO products (establishment_id,code,name,category,price_cents) VALUES ($1,$2,$3,$4,$5) RETURNING id', [e.id, code, name, cat, price])).rows[0];
    await c.query('INSERT INTO product_prices (product_id,price_cents) VALUES ($1,$2)', [p.id, price]);
  }
  await c.query('COMMIT');
  console.log(`Seed concluído. Usuários de teste (senha: ${PASSWORD}):`);
  for (const [, email, role] of users) console.log(`  ${role.padEnd(10)} ${email}`);
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
