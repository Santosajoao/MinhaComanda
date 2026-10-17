# 02 — Banco de dados

Arquivo único de schema: `backend/migrations/001_init.sql`. PostgreSQL 14+ (testado na 16).
`gen_random_uuid()` é nativo (PG ≥ 13); não há extensões a instalar.

## 1. Migrações

- `npm run db:migrate` (`src/database/migrate.ts`) aplica, em ordem alfabética, cada `migrations/*.sql` ainda não registrado na tabela `schema_migrations`. Cada arquivo roda em **uma transação**; se falhar, nada é aplicado.
- `npm run db:seed` cria dados de exemplo **somente se não houver nenhum estabelecimento**.
- `npm run db:reset` **apaga o schema `public` inteiro** e recria (recusado com `NODE_ENV=production`).
- **Regra de manutenção:** nunca edite `001_init.sql` depois que existir um banco com dados. Crie `002_descricao.sql` com `ALTER TABLE …`. (Durante o desenvolvimento inicial o 001 foi ajustado e o banco recriado; isso não vale mais após o primeiro uso real.)

## 2. Tabelas

### Cadastros

| Tabela | Finalidade | Pontos importantes |
|---|---|---|
| `establishments` | Estabelecimento e **regras configuráveis** | `number_mode` (`auto`/`manual`), `number_min/max/pad`, `number_reuse`, `service_fee_bps` (1000 = 10%), `max_discount_bps` (limite do supervisor), `cpf_policy` (`required`/`optional`/`none`), `allow_partial_payment` |
| `events` | Evento/sessão (ex.: "Noite de Sábado") | `status` `aberto`/`encerrado`; novas comandas entram no evento aberto mais recente |
| `users` | Usuários | `role` ∈ admin, gerente, recepcao, atendente, caixa, supervisor, auditor; e-mail único (índice em `lower(email)`); `password_hash` bcrypt; `active` |
| `terminals` | Pontos de venda / dispositivos | `sector` (ex.: `bar`, `cozinha`, `caixa`) usado para restringir produtos |
| `consumers` | Dados do consumidor | `cpf_enc` (AES-256-GCM, base64), `cpf_hash` (HMAC por estabelecimento) com índice único parcial `uq_consumers_cpf` |
| `products` | Catálogo | `price_cents`; promoção (`promo_price_cents` + `promo_starts_at/ends_at`, com CHECK de coerência); `sectors text[]` (vazio = todos); `active` |
| `product_prices` | Histórico de preços | uma linha a cada criação/mudança de preço ou promoção, com `changed_by` |

### Operação

| Tabela | Finalidade | Pontos importantes |
|---|---|---|
| `tabs` | **Comanda** | `id` UUID imutável; `number` texto; `status` (8 valores); `service_fee_bps` **copiado do estabelecimento na abertura**; `opened_by/at/terminal`; `checked_by/at`; `statement_confirmed_at`; `closed_by/at`; `close_exception`; `reopen_count`; `cancel_reason` |
| `tab_items` | Itens lançados | `description`, `category`, `unit_price_cents`, `subtotal_cents` **copiados do produto na hora do lançamento**; `status` `valido`/`cancelado`; `batch_key` + `line_no` (idempotência); `created_by`, `terminal_id`; campos de cancelamento |
| `tab_adjustments` | Cancelamentos e descontos | `type` `cancelamento`/`desconto`; `amount_cents`; `reason`; `created_by`, `approved_by`; `revoked_*` (descontos revertidos continuam registrados) |
| `payments` | Pagamentos | `method`, `amount_cents`, `status` (`pendente`/`confirmado`/`recusado`/`cancelado`/`estornado`), `reference`, `cash_received_cents`, `idempotency_key` **único**, `cash_session_id` |
| `payment_refunds` | Estornos | imutável; `requested_by` e `approved_by` |
| `cash_sessions` | Turno de caixa | `opening_cents`, `counted_cents`, `expected_cents`, `difference_cents`; índice único parcial: **um caixa aberto por usuário** |
| `audit_events` | Auditoria | `bigserial`; `before`/`after` em `jsonb`; imutável |
| `schema_migrations` | Controle de migrações | criada pelo `migrate.ts` |

## 3. Índices únicos que implementam regras

| Índice | Regra |
|---|---|
| `uq_tabs_active_number` em `tabs(establishment_id, number) WHERE status NOT IN ('encerrada','cancelada')` | **RN-03:** não existem duas comandas *ativas* com o mesmo número; número liberado após encerrar/cancelar. Reabrir uma comanda cujo número foi reaproveitado falha com `COMANDA_OCUPADA`. |
| `uq_consumers_cpf` | Um CPF = um cadastro por estabelecimento (consumidor recorrente reaproveitado). |
| `uq_cash_open_per_user` | Um caixa aberto por operador. |
| `uq_users_email` | E-mail único (case-insensitive). |
| `payments.idempotency_key UNIQUE` | Pagamento repetido não duplica. |
| `tab_items UNIQUE (batch_key, line_no)` | Lançamento repetido não duplica itens. |

CHECKs relevantes: `subtotal_cents = quantity * unit_price_cents`, `quantity BETWEEN 1 AND 999`, valores monetários ≥ 0, `amount_cents > 0` em pagamentos/estornos, promoção com início < fim.

## 4. Triggers (proteção no próprio banco)

| Trigger | Efeito |
|---|---|
| `trg_audit_immutable` | **Proíbe UPDATE/DELETE** em `audit_events` |
| `trg_refunds_immutable` | Proíbe UPDATE/DELETE em `payment_refunds` |
| `trg_items_nodelete`, `trg_payments_nodelete`, `trg_adj_nodelete`, `trg_tabs_nodelete` | Proíbem DELETE (correção = registro compensatório) |
| `trg_items_immutable` | Proíbe alterar `tab_id`, `product_id`, `description`, `quantity`, `unit_price_cents`, `subtotal_cents`, `created_at` de um item (só `status` e campos de cancelamento mudam) — **RN-05** |
| `trg_items_open_tab` | `INSERT` em `tab_items` só se a comanda está `aberta` — reforço da **RN-10** |
| `trg_payments_immutable` | Proíbe alterar `tab_id`, `amount_cents`, `method` de um pagamento |

A mensagem do trigger (`RAISE EXCEPTION`) chega à API como `REGRA_DE_NEGOCIO` (409). Todas essas proteções são testadas em `e2e.mjs` (seção 12).

> **Atenção de manutenção:** se precisar corrigir dados manualmente em produção, desabilite o trigger específico, corrija e reabilite — e registre o ocorrido em `CHANGELOG.md`. Nunca "limpe" a auditoria.

## 5. Função `tab_totals(p_tab uuid)` — fonte única da verdade (RN-06)

Retorna uma linha com (todos em centavos):

| Coluna | Cálculo |
|---|---|
| `gross_cents` | soma de `tab_items.subtotal_cents` com `status='valido'` |
| `cancelled_cents` | soma dos itens `cancelado` (informativo) |
| `discount_cents` | `LEAST(soma dos descontos não revertidos, gross)` |
| `fee_cents` | `ROUND((gross − discount) × tabs.service_fee_bps / 10000)` |
| `net_cents` | `gross − discount + fee` (**total devido**) |
| `paid_cents` | soma de pagamentos `confirmado` |
| `pending_cents` | soma de pagamentos `pendente` |
| `balance_cents` | `net − paid` (pendente **não** abate o saldo) |

Usada por: `TabsService.view/list/refreshStatus`, ajustes, pagamentos, fechamento, relatórios (`LATERAL tab_totals(t.id)`). **Nunca recalcule totais em TypeScript**; altere a função (nova migração `CREATE OR REPLACE FUNCTION`).

Exemplo (documento, seção 4.1): 3×15 + 2×6 + 1×38 = 95,00; desconto 5,00 → 90,00; Pix 50,00 + cartão 40,00 confirmados → saldo 0. Se o cartão está `pendente`, `paid=50,00`, `pending=40,00`, `balance=40,00` — a comanda **não** é considerada paga.

## 6. Diagrama de relacionamentos (resumo)

```
establishments 1─* events, users, terminals, consumers, products, tabs, cash_sessions
consumers      1─* tabs
events         1─* tabs
tabs           1─* tab_items, tab_adjustments, payments
tab_items      1─* tab_adjustments (cancelamento de item)
payments       1─* payment_refunds
cash_sessions  1─* payments, payment_refunds
products       1─* product_prices, tab_items
users          referenciado por opened_by, closed_by, created_by, approved_by, changed_by …
```

## 7. Retenção e backup

- Nada é apagado pelo sistema; não há rotina de expurgo. Defina a política de retenção (LGPD/fiscal) e implemente expurgo/anonimização de `consumers` por migração/rotina própria — ver [07](07-SEGURANCA-E-LGPD.md).
- Backup: ver [09](09-OPERACAO-E-MANUTENCAO.md).
