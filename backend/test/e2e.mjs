// Teste de ponta a ponta contra a API em execução (http://localhost:3001) e o banco local.
// Uso: com a API rodando e o banco semeado -> npm run test:e2e
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import 'dotenv/config';

const BASE = process.env.API_URL || 'http://localhost:3001/api/v1';
const PASS = 'Senha@123';
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✔ ${name}`); } else { failed++; console.log(`  ✘ ${name} ${extra ? '-> ' + JSON.stringify(extra) : ''}`); }
};
async function api(method, path, { token, body, key, terminal, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  if (terminal) headers['X-Terminal-Id'] = terminal;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data, code: data?.error?.code };
}
const login = async (role) => (await api('POST', '/auth/login', { body: { email: `${role}@exemplo.com`, password: PASS } })).data;
const section = (t) => console.log(`\n${t}`);
const uniq = () => randomUUID();

const T = {};
section('1. Autenticação e permissões');
for (const r of ['admin', 'gerente', 'recepcao', 'atendente', 'caixa', 'supervisor', 'auditor']) { const l = await login(r); T[r] = l?.token; }
check('login dos 7 perfis', Object.values(T).every(Boolean));
check('senha errada retorna 401', (await api('POST', '/auth/login', { body: { email: 'caixa@exemplo.com', password: 'errada123' } })).status === 401);
check('sem token retorna 401', (await api('GET', '/tabs')).status === 401);
check('atendente não pode abrir comanda', (await api('POST', '/tabs', { token: T.atendente, body: { name: 'X Y' } })).status === 403);
check('caixa não pode criar produto', (await api('POST', '/products', { token: T.caixa, body: { code: 'Z', name: 'Zzz', price_cents: 100 } })).status === 403);
check('auditor não pode lançar itens', (await api('POST', '/tabs/00000000-0000-0000-0000-000000000000/items', { token: T.auditor, key: uniq(), body: {} })).status === 403);

const terminals = (await api('GET', '/terminals', { token: T.caixa })).data;
const bar = terminals.find((t) => t.name === 'Bar 1').id;
const caixaT = terminals.find((t) => t.name === 'Caixa 1').id;
const products = (await api('GET', '/products?active=true', { token: T.atendente })).data;
const P = (code) => products.find((p) => p.code === code);

section('2. Abertura de comandas (RF-01, RF-02)');
let r = await api('POST', '/tabs', { token: T.recepcao, terminal: terminals[0].id, body: { number: 428, name: 'João da Silva', cpf: '529.982.247-25' } });
check('abre comanda 428 com zeros à esquerda', r.status === 201 && r.data.number === '00428', r.data);
check('CPF é mascarado na resposta', r.data?.consumer?.cpf_masked === '***.982.247-**' && !JSON.stringify(r.data).includes('52998224725'), r.data?.consumer);
const tab428 = r.data.id; const consumerId = r.data.consumer.id;
r = await api('POST', '/tabs', { token: T.recepcao, body: { number: '00428', name: 'Outro Nome' } });
check('abrir comanda ocupada é bloqueado', r.status === 409 && r.code === 'COMANDA_OCUPADA', r.data);
r = await api('POST', '/tabs', { token: T.recepcao, body: { name: 'Fulano', cpf: '123.456.789-00' } });
check('CPF inválido é rejeitado', r.status === 400 && r.code === 'CPF_INVALIDO', r.data);
r = await api('POST', '/tabs', { token: T.recepcao, body: { name: 'João da Silva', cpf: '52998224725' } });
check('numeração automática + consumidor recorrente reaproveitado', r.status === 201 && r.data.consumer.id === consumerId && r.data.number === '00001', r.data);
const tabAuto = r.data.id;
r = await api('POST', '/tabs', { token: T.recepcao, body: { number: 5000, name: 'Fora Faixa' } });
check('número fora da faixa é rejeitado', r.status === 422, r.data);
r = await api('GET', '/tabs/428', { token: T.caixa });
check('consulta por número (sem zeros) localiza a comanda', r.status === 200 && r.data.id === tab428);
r = await api('GET', `/consumers/${consumerId}?reveal=true`, { token: T.recepcao });
check('recepção não vê CPF completo', r.status === 200 && !r.data.cpf && r.data.cpf_masked);
r = await api('GET', `/consumers/${consumerId}?reveal=true`, { token: T.gerente });
check('gerente vê CPF completo (auditado)', r.data.cpf === '52998224725');

section('3. Consumo (RF-05) e preços (RN-05)');
const cerv = P('CERV01'), agua = P('SA01'), porcao = P('POR01');
let key1 = uniq();
const batch = { items: [{ product_id: cerv.id, quantity: 3 }, { product_id: agua.id, quantity: 2 }, { product_id: porcao.id, quantity: 1 }] };
r = await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, terminal: bar, key: key1, body: batch });
check('lança 3 cervejas, 2 águas, 1 porção = R$ 95,00', r.status === 200 && r.data.tab.totals.gross_cents === 9500, r.data?.tab?.totals);
r = await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, terminal: bar, key: key1, body: batch });
check('requisição repetida não duplica (idempotência)', r.status === 200 && r.data.replayed === true && r.data.tab.totals.gross_cents === 9500, r.data?.tab?.totals);
r = await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, body: batch });
check('Idempotency-Key é obrigatória', r.status === 400 && r.code === 'IDEMPOTENCY_KEY_OBRIGATORIA');
r = await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: cerv.id, quantity: 0 }] } });
check('quantidade inválida é rejeitada', r.status === 400);
// alteração de preço
r = await api('PATCH', `/products/${cerv.id}`, { token: T.gerente, body: { price_cents: 1700 } });
check('gerente altera preço da cerveja para R$ 17,00', r.status === 200 && r.data.price_cents === 1700, r.data);
r = await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: cerv.id, quantity: 1 }] } });
check('novo lançamento usa o preço novo (R$ 17,00)', r.data?.items?.[0]?.unit_price_cents === 1700, r.data?.items);
const extraItemId = r.data.items[0].id;
await api('PATCH', `/products/${cerv.id}`, { token: T.gerente, body: { price_cents: 1500 } });
let items = (await api('GET', `/tabs/${tab428}/items`, { token: T.caixa })).data;
check('itens antigos preservam R$ 15,00', items.filter((i) => i.description === 'Cerveja Long Neck' && i.unit_price_cents === 1500).length === 1 && items.length === 4, items.map((i) => i.unit_price_cents));
check('histórico de preços registrado', (await api('GET', `/products/${cerv.id}/prices`, { token: T.gerente })).data.length >= 3);

section('4. Concorrência (RN-09)');
r = await api('POST', '/tabs', { token: T.recepcao, body: { number: 429, name: 'Concorrência Teste' } });
const tab429 = r.data.id;
const par = await Promise.all(Array.from({ length: 25 }, () => api('POST', `/tabs/${tab429}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: agua.id, quantity: 1 }] } })));
check('25 lançamentos simultâneos: todos aceitos', par.every((x) => x.status === 200), par.filter((x) => x.status !== 200).map((x) => x.data));
r = await api('GET', '/tabs/429', { token: T.caixa });
check('nenhum item perdido ou duplicado (25 × R$ 6,00 = R$ 150,00)', r.data.totals.gross_cents === 15000, r.data.totals);
const sameKey = uniq();
const par2 = await Promise.all(Array.from({ length: 8 }, () => api('POST', `/tabs/${tab429}/items`, { token: T.atendente, key: sameKey, body: { items: [{ product_id: agua.id, quantity: 1 }] } })));
r = await api('GET', '/tabs/429', { token: T.caixa });
check('8 envios simultâneos com a mesma chave criam 1 item só', par2.every((x) => x.status === 200) && r.data.totals.gross_cents === 15600, r.data.totals);

section('5. Cancelamentos, descontos e autorização (RF-08, RF-09)');
r = await api('POST', `/tabs/${tab428}/adjustments`, { token: T.atendente, body: { type: 'cancelamento', item_id: extraItemId, reason: 'Pedido lançado por engano' } });
check('atendente sem aprovação não cancela item', r.status === 403 && r.code === 'APROVACAO_NECESSARIA', r.data);
r = await api('POST', `/tabs/${tab428}/adjustments`, { token: T.atendente, body: { type: 'cancelamento', item_id: extraItemId, reason: 'Pedido lançado por engano', approval: { email: 'caixa@exemplo.com', password: PASS } } });
check('aprovação por perfil sem permissão é recusada', r.status === 403 && r.code === 'APROVACAO_INVALIDA', r.data);
r = await api('POST', `/tabs/${tab428}/adjustments`, { token: T.atendente, body: { type: 'cancelamento', item_id: extraItemId, reason: 'Pedido lançado por engano', approval: { email: 'supervisor@exemplo.com', password: PASS } } });
check('cancelamento aprovado por supervisor (histórico preservado)', r.status === 201 && r.data.tab.totals.gross_cents === 9500 && r.data.tab.totals.cancelled_cents === 1700, r.data?.tab?.totals);
items = (await api('GET', `/tabs/${tab428}/items`, { token: T.caixa })).data;
check('item cancelado continua no histórico', items.length === 4 && items.some((i) => i.status === 'cancelado' && i.cancel_reason));
r = await api('POST', `/tabs/${tab428}/adjustments`, { token: T.supervisor, body: { type: 'desconto', percent: 20, reason: 'Cliente VIP' } });
check('supervisor não ultrapassa o limite de desconto (10%)', r.status === 403 && r.code === 'DESCONTO_ACIMA_DO_LIMITE', r.data);
r = await api('POST', `/tabs/${tab428}/adjustments`, { token: T.caixa, body: { type: 'desconto', amount_cents: 500, reason: 'Cortesia da casa', approval: { email: 'supervisor@exemplo.com', password: PASS } } });
check('desconto de R$ 5,00 aprovado: líquido R$ 90,00', r.status === 201 && r.data.tab.totals.net_cents === 9000, r.data?.tab?.totals);
r = await api('POST', `/tabs/${tab428}/adjustments`, { token: T.supervisor, body: { type: 'desconto', amount_cents: 99999, reason: 'Exagero' } });
check('desconto maior que o consumo é rejeitado', r.status === 422, r.data);

section('6. Conferência e pagamentos (RF-06, RF-07)');
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: uniq(), body: { method: 'pix', amount_cents: 1000, reference: 'E123' } });
check('não recebe pagamento antes da conferência', r.status === 409 && r.code === 'COMANDA_NAO_PAGAVEL', r.data);
check('atendente não inicia conferência', (await api('POST', `/tabs/${tab428}/checkout`, { token: T.atendente })).status === 403);
r = await api('POST', `/tabs/${tab428}/checkout`, { token: T.caixa });
check('caixa inicia conferência; extrato calculado no servidor', r.status === 200 && r.data.tab.status === 'em_conferencia' && r.data.tab.totals.balance_cents === 9000 && r.data.items.length === 4, r.data?.tab);
r = await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: agua.id, quantity: 1 }] } });
check('comanda em conferência não aceita novos itens', r.status === 409 && r.code === 'COMANDA_NAO_ABERTA', r.data);
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: uniq(), body: { method: 'pix', amount_cents: 5000, reference: 'E123' } });
check('pagamento exige caixa aberto', r.status === 409 && r.code === 'CAIXA_FECHADO', r.data);
r = await api('POST', '/cash-register/open', { token: T.caixa, terminal: caixaT, body: { opening_cents: 10000 } });
check('caixa abre turno com troco inicial de R$ 100,00', r.status === 201 && r.data.opening_cents === 10000, r.data);
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: uniq(), body: { method: 'pix', amount_cents: 99999, reference: 'E123' } });
check('pagamento acima do saldo é rejeitado', r.status === 422 && r.code === 'VALOR_EXCEDE_SALDO', r.data);
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: uniq(), body: { method: 'pix', amount_cents: 1000 } });
check('Pix exige referência da transação', r.status === 422 && r.code === 'REFERENCIA_OBRIGATORIA', r.data);
const pixKey = uniq();
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: pixKey, body: { method: 'pix', amount_cents: 5000, reference: 'E2024PIX0001' } });
check('Pix de R$ 50,00 confirmado → parcialmente paga', r.status === 200 && r.data.tab.status === 'parcialmente_paga' && r.data.tab.totals.balance_cents === 4000, r.data?.tab);
const pix1 = r.data.payment.id;
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: pixKey, body: { method: 'pix', amount_cents: 5000, reference: 'E2024PIX0001' } });
check('Pix repetido (mesma chave) não duplica', r.status === 200 && r.data.replayed === true && r.data.tab.totals.paid_cents === 5000, r.data?.tab?.totals);
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: uniq(), body: { method: 'credito', amount_cents: 4000, status: 'pendente', reference: 'NSU778899' } });
check('cartão pendente não conta como pago', r.status === 200 && r.data.tab.totals.paid_cents === 5000 && r.data.tab.totals.pending_cents === 4000 && r.data.tab.status === 'parcialmente_paga', r.data?.tab);
const cardPay = r.data.payment.id;
r = await api('POST', `/tabs/${tab428}/close`, { token: T.caixa, body: {} });
check('fechamento normal bloqueado com saldo pendente', r.status === 409 && r.code === 'SALDO_PENDENTE', r.data);
r = await api('POST', `/payments/${cardPay}/confirm`, { token: T.caixa, body: {} });
check('confirmação do cartão quita a conta → paga', r.status === 200 && r.data.tab.status === 'paga' && r.data.tab.totals.balance_cents === 0, r.data?.tab);
r = await api('POST', `/tabs/${tab428}/close`, { token: T.caixa, body: {} });
check('encerra a comanda', r.status === 200 && r.data.tab.status === 'encerrada' && r.data.tab.closed_by_name, r.data?.tab);
r = await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: agua.id, quantity: 1 }] } });
check('comanda encerrada não aceita lançamentos', r.status === 409, r.data);

section('7. Reabertura, dinheiro e estorno');
r = await api('POST', `/tabs/${tab428}/reopen`, { token: T.caixa, body: { reason: 'Cliente pediu mais uma água' } });
check('reabertura exige autorização', r.status === 403 && r.code === 'APROVACAO_NECESSARIA', r.data);
r = await api('POST', `/tabs/${tab428}/reopen`, { token: T.caixa, body: { reason: 'Cliente pediu mais uma água', approval: { email: 'supervisor@exemplo.com', password: PASS } } });
check('reabertura com supervisor', r.status === 200 && r.data.status === 'aberta' && r.data.reopen_count === 1, r.data);
r = await api('POST', '/tabs', { token: T.recepcao, body: { number: 428, name: 'Intruso' } });
check('número da comanda reaberta fica ocupado de novo', r.status === 409 && r.code === 'COMANDA_OCUPADA', r.data);
await api('POST', `/tabs/${tab428}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: agua.id, quantity: 1 }] } });
r = await api('POST', `/tabs/${tab428}/checkout`, { token: T.caixa });
check('nova conferência: saldo R$ 6,00', r.data.tab.totals.balance_cents === 600, r.data?.tab?.totals);
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: uniq(), body: { method: 'dinheiro', amount_cents: 600, cash_received_cents: 1000 } });
check('dinheiro com troco de R$ 4,00; comanda paga', r.status === 200 && r.data.change_cents === 400 && r.data.tab.status === 'paga', r.data);
r = await api('POST', `/payments/${pix1}/refunds`, { token: T.caixa, body: { reason: 'Pix enviado em duplicidade' } });
check('estorno sem aprovação de gerente é recusado', r.status === 403, r.data);
r = await api('POST', `/payments/${pix1}/refunds`, { token: T.caixa, body: { reason: 'Pix enviado em duplicidade', approval: { email: 'gerente@exemplo.com', password: PASS } } });
check('estorno aprovado: saldo volta a R$ 50,00', r.status === 201 && r.data.tab.totals.balance_cents === 5000 && r.data.tab.status === 'parcialmente_paga', r.data?.tab);
r = await api('POST', `/tabs/${tab428}/payments`, { token: T.caixa, key: uniq(), body: { method: 'debito', amount_cents: 5000, reference: 'NSU0001122' } });
check('refaz o pagamento por débito → paga', r.status === 200 && r.data.tab.status === 'paga', r.data?.tab);
r = await api('POST', `/tabs/${tab428}/close`, { token: T.caixa, body: {} });
check('encerra novamente', r.status === 200 && r.data.tab.status === 'encerrada');

section('8. Pagamentos simultâneos');
r = await api('POST', '/tabs', { token: T.recepcao, body: { number: 433, name: 'Pagamento Paralelo' } });
const tab433 = r.data.id;
await api('POST', `/tabs/${tab433}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: cerv.id, quantity: 1 }] } });
await api('POST', `/tabs/${tab433}/checkout`, { token: T.caixa });
const same = uniq();
const pays = await Promise.all(Array.from({ length: 6 }, () => api('POST', `/tabs/${tab433}/payments`, { token: T.caixa, key: same, body: { method: 'pix', amount_cents: 1500, reference: 'E-PAR-001' } })));
r = await api('GET', `/tabs/${tab433}/payments`, { token: T.caixa });
check('6 envios paralelos da mesma chave geram 1 pagamento', pays.every((p) => p.status === 200) && r.data.length === 1, pays.map((p) => p.status));
r = await api('POST', '/tabs', { token: T.recepcao, body: { number: 434, name: 'Dois Caixas' } });
const tab434 = r.data.id;
await api('POST', `/tabs/${tab434}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: cerv.id, quantity: 1 }] } });
await api('POST', `/tabs/${tab434}/checkout`, { token: T.caixa });
const two = await Promise.all([1, 2].map((n) => api('POST', `/tabs/${tab434}/payments`, { token: T.caixa, key: uniq(), body: { method: 'pix', amount_cents: 1500, reference: 'E-DUP-00' + n } })));
check('dois pagamentos incompatíveis simultâneos: só um é aceito', two.filter((x) => x.status === 200).length === 1 && two.filter((x) => [409, 422].includes(x.status)).length === 1, two.map((x) => x.status));
await api('POST', `/tabs/${tab434}/close`, { token: T.caixa, body: {} });

section('9. Encerramento por exceção administrativa');
r = await api('POST', '/tabs', { token: T.recepcao, body: { number: 431, name: 'Comanda Perdida' } });
const tab431 = r.data.id;
await api('POST', `/tabs/${tab431}/items`, { token: T.atendente, key: uniq(), body: { items: [{ product_id: cerv.id, quantity: 2 }] } });
await api('POST', `/tabs/${tab431}/checkout`, { token: T.caixa });
r = await api('POST', `/tabs/${tab431}/close`, { token: T.caixa, body: { exception: { reason: 'Comanda perdida pelo cliente' } } });
check('exceção sem gerente é recusada', r.status === 403, r.data);
r = await api('POST', `/tabs/${tab431}/close`, { token: T.caixa, body: { exception: { reason: 'Comanda perdida pelo cliente' }, approval: { email: 'gerente@exemplo.com', password: PASS } } });
check('exceção autorizada por gerente encerra com saldo', r.status === 200 && r.data.tab.status === 'encerrada' && r.data.tab.close_exception && r.data.tab.totals.balance_cents === 3000, r.data?.tab);

section('10. Caixa, relatórios e auditoria');
r = await api('POST', '/cash-register/close', { token: T.caixa, body: { counted_cents: 10500, notes: 'Contagem do turno' } });
check('fechamento de caixa: esperado R$ 106,00 e diferença -R$ 1,00', r.status === 200 && r.data.expected_cash_cents === 10600 && r.data.difference_cents === -100, r.data);
r = await api('GET', '/reports/summary', { token: T.gerente });
check('relatório resumo traz vendas, pagamentos e divergências', r.status === 200 && r.data.totals.gross_sales_cents > 0 && r.data.payments_by_method.length > 0 && r.data.divergences.some((d) => d.number === '00431'), r.data?.totals);
check('relatório por produto lista Cerveja Long Neck', r.data.by_product.some((p) => p.description === 'Cerveja Long Neck'));
check('caixa não acessa relatórios', (await api('GET', '/reports/summary', { token: T.caixa })).status === 403);
r = await api('GET', '/reports/export?type=payments', { token: T.gerente, raw: true });
check('exportação CSV de pagamentos', r.status === 200 && r.headers.get('content-type').includes('text/csv') && r.text.includes('Comanda;'));
r = await api('GET', '/audit-events?limit=500', { token: T.auditor });
const types = new Set(r.data.map((e) => e.type));
check('auditoria registra operações críticas', ['tab.open', 'item.launch', 'adjustment.desconto', 'payment.create', 'payment.refund', 'tab.close_exception', 'tab.reopen', 'product.price_change', 'cash.close'].every((t) => types.has(t)), [...types]);
check('auditoria não grava senhas', !JSON.stringify(r.data).includes(PASS));
check('caixa não acessa a auditoria', (await api('GET', '/audit-events', { token: T.caixa })).status === 403);

section('11. Isolamento entre estabelecimentos (RN-14)');
const emailB = `gerenteb${Date.now()}@outra.com`;
r = await api('POST', '/admin/establishments', { token: T.admin, body: { name: 'Restaurante B ' + Date.now(), manager: { name: 'Gerente B', email: emailB, password: 'OutraSenha123' } } });
check('admin cria novo estabelecimento', r.status === 201, r.data);
const tb = (await api('POST', '/auth/login', { body: { email: emailB, password: 'OutraSenha123' } })).data?.token;
check('gerente do outro estabelecimento não vê a comanda 428', (await api('GET', '/tabs/428', { token: tb })).status === 404);
check('nem pelo ID', (await api('GET', `/tabs/${tab428}`, { token: tb })).status === 404);
check('nem o extrato', (await api('GET', `/tabs/${tab428}/statement`, { token: tb })).status === 404);
check('catálogo do outro estabelecimento é vazio', (await api('GET', '/products', { token: tb })).data.length === 0);
check('gerente comum não cria estabelecimentos', (await api('POST', '/admin/establishments', { token: T.gerente, body: {} })).status === 403);

section('12. Proteções do banco de dados');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const tryq = async (sql) => { try { await db.query(sql); return false; } catch { return true; } };
check('trigger bloqueia UPDATE em auditoria', await tryq(`UPDATE audit_events SET type='x'`));
check('trigger bloqueia DELETE em auditoria', await tryq(`DELETE FROM audit_events`));
check('trigger bloqueia alterar preço de item lançado', await tryq(`UPDATE tab_items SET unit_price_cents = 1, subtotal_cents = quantity`));
check('trigger bloqueia apagar item', await tryq(`DELETE FROM tab_items`));
check('trigger bloqueia apagar pagamento', await tryq(`DELETE FROM payments`));
check('trigger bloqueia alterar valor de pagamento', await tryq(`UPDATE payments SET amount_cents = amount_cents + 1`));
check('banco recusa item em comanda encerrada', await tryq(`INSERT INTO tab_items (tab_id,product_id,description,category,quantity,unit_price_cents,subtotal_cents,batch_key,line_no,created_by)
  SELECT t.id, p.id, 'x','x',1,1,1,'k-'||gen_random_uuid(),0,t.opened_by FROM tabs t, products p WHERE t.status='encerrada' LIMIT 1`));
await db.end();

// limpeza: encerra comandas de teste que ficaram abertas
for (const id of [tabAuto, tab429]) {
  await api('POST', `/tabs/${id}/cancel`, { token: T.gerente, body: { reason: 'limpeza do teste' } });
}
console.log(`\nResultado: ${passed} aprovados, ${failed} falhas`);
process.exit(failed ? 1 : 0);
