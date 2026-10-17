# 03 — Backend, módulo a módulo

Para cada módulo: responsabilidade, métodos, fluxo, travas, auditoria emitida e erros. Os códigos de erro estão descritos em [04-API](04-API.md#códigos-de-erro).

## Núcleo comum (`src/common`, `src/config`)

| Arquivo | O que faz |
|---|---|
| `config/env.ts` | Lê `.env` (dotenv). Exige `DATABASE_URL`, `JWT_SECRET`, `DATA_KEY` (64 hex). Em produção exige `JWT_SECRET` ≥ 32 caracteres. Exporta `env`. Falha **ao iniciar** se algo faltar. |
| `database/database.service.ts` | `DatabaseService`: `query()` e `tx(fn)` (BEGIN/COMMIT/ROLLBACK + release). Converte `bigint` (OID 20) e `numeric` (OID 1700) em `number`, por isso somas de centavos chegam como número. Interface `Q` aceita pool **ou** client de transação. |
| `errors/app-error.ts` | `AppError(status, code, message, details?)` + `notFound`, `badRequest`, `conflict`, `forbidden`, `unprocessable`. |
| `errors/all-exceptions.filter.ts` | Filtro global. Mapeia: `AppError`; `ZodError`→400 `VALIDACAO`; `HttpException`; JSON inválido; erros PG (`23505` por nome da constraint, `P0001` trigger→409 `REGRA_DE_NEGOCIO`, `22P02`→400, `23503`→409, `23514`→422, `40P01/40001`→503). Erros ≥ 500 são logados com stack. |
| `authorization/auth.guard.ts` | Ver [01 §3](01-ARQUITETURA.md#3-ciclo-de-vida-de-uma-requisição). |
| `authorization/context.ts` | Tipos e decorators. `@Roles()` sem argumentos = qualquer usuário autenticado. |
| `crypto/crypto.ts` | `encrypt/decrypt` (AES-256-GCM, formato base64 de `iv(12)+tag(16)+cifra`), `hashCpf(estabelecimento, cpf)` (HMAC-SHA256). |
| `validation/parse.ts` | `parse(schema, dados)`, schemas reutilizáveis: `uuid`, `approvalSchema`, `reasonSchema` (3–300 caracteres), `cents`. |
| `validation/cpf.ts` | `onlyDigits`, `isValidCpf` (dígitos verificadores, rejeita sequências iguais), `maskCpf` (`***.982.247-**`). |

## auth — `modules/auth/auth.module.ts`

- **`AuthService.login`**: valida corpo; limita tentativas (8 falhas por `email|ip` em 15 min → 429 `MUITAS_TENTATIVAS`, em memória: reinicia com a API); compara bcrypt; emite JWT (`sub`, `role`, 10 h). Audita `auth.login` e `auth.login_failed`. Retorna `{ token, user, establishment, cashSession }`.
- **`profile(userId)`**: usuário + configurações do estabelecimento + caixa aberto do usuário.
- **`changePassword`**: exige senha atual; nova com ≥ 8 caracteres; audita `user.password_change`.
- **`ApprovalService.approve(q, ctx, allowedRoles, approval, actionLabel)`** — *autorização adicional*:
  1. Se o próprio usuário tem um dos perfis permitidos → autoriza (`self: true`).
  2. Senão exige `approval {email, password}` de **outro** usuário ativo, **do mesmo estabelecimento**, com perfil permitido e senha correta. Caso contrário 403 `APROVACAO_NECESSARIA` (faltou) ou `APROVACAO_INVALIDA` (credencial/perfil errados; audita `auth.approval_denied` fora da transação para não ser desfeito pelo rollback).
  3. Retorna `approverId`, gravado como `approved_by`.
- Constante `ESTABLISHMENT_COLUMNS`: colunas de configuração expostas ao front.

## audit — `modules/audit/audit.service.ts`

- **`log(q|null, ctx|null, evento)`**: insere em `audit_events`. Passe o `client` da transação para atomicidade; `null` usa o pool (eventos que não podem ser revertidos, como login falho).
- **`list`**: filtros `type` (prefixo, `LIKE 'x%'`), `user_id`, `entity_id`, `from`, `to`, `limit` (≤ 500), `before_id` (paginação). Sempre filtra pelo estabelecimento.
- **Tipos de evento emitidos:** `auth.login`, `auth.login_failed`, `auth.approval_denied`, `user.create|update|permission_change|password_reset|password_change`, `establishment.create|update`, `event.create|close`, `terminal.create|update`, `consumer.create|update|cpf_reveal`, `product.create|update|price_change`, `tab.open|checkout|statement_confirmed|resume|close|close_exception|reopen|block|unblock|cancel`, `item.launch`, `adjustment.cancelamento|desconto|revoke`, `payment.create|confirm|reject|cancel|refund`, `cash.open|close`, `report.export`.
- Nunca grava senha/token (testado).

## tabs — `modules/tabs/tabs.service.ts` (núcleo)

| Método | Descrição |
|---|---|
| `lock(c, ctx, id)` | `SELECT * FROM tabs … FOR UPDATE` filtrando estabelecimento; 404 se não existir. **Chamar sempre primeiro** em operações que alteram a comanda. |
| `view(q, ctx, id)` | Comanda + consumidor (CPF mascarado) + totais via `tab_totals` (SQL `VIEW_SQL`); `mapTab` formata a resposta. |
| `resolveId(q, ctx, chave)` | Aceita UUID **ou** número (com/sem zeros: `428`→`00428`). Para número, prefere a comanda ativa; senão a mais recente. |
| `get`, `list` | Consulta; `list` filtra `status` (lista separada por vírgula), `q` (número/nome), `event_id`, `limit` (≤ 500). |
| `normalizeNumber(est, n)` | Só dígitos (≤ 12), valida faixa `number_min..max` (422 `NUMERO_FORA_DA_FAIXA`), completa com zeros (`number_pad`). |
| `nextNumber` (privado) | Menor número livre da faixa (`generate_series`), excluindo ativos e — se `number_reuse=false` — os já usados no evento. |
| `open(ctx, corpo)` | Ver abaixo. |
| `refreshStatus(c, tabId)` | Recalcula estado financeiro (ver [05 §2](05-REGRAS-DE-NEGOCIO.md#2-recálculo-automático-do-estado-financeiro)). Chamar após qualquer mudança em itens cancelados, descontos ou pagamentos. |
| `block/unblock/cancel` | Bloqueio (só `aberta`), desbloqueio, cancelamento da abertura (sem itens válidos e sem pagamentos; exige supervisor+ ou aprovação). |

**`open` — fluxo:** transação → `pg_advisory_xact_lock('tabs-open:<estab>')` (serializa numeração automática) → carrega configurações → define evento (informado ou o aberto mais recente) → define número (informado → normaliza; vazio + modo `manual` → 400 `NUMERO_OBRIGATORIO`; vazio + `auto` → `nextNumber`) → rejeita se já ativa (`COMANDA_OCUPADA`) ou, com `number_reuse=false`, se já usada no evento → resolve consumidor (`ConsumersService.resolve`) → insere com `service_fee_bps` copiado do estabelecimento → audita `tab.open`.

## consumers — `modules/consumers/consumers.module.ts`

- **`resolve(c, ctx, est, {consumer_id?, name?, cpf?})`** (usado na abertura): aplica `cpf_policy` (`none` ignora CPF; `required` exige), valida CPF, reaproveita consumidor com o mesmo CPF (`cpf_hash`), senão cria. Com `consumer_id`, só completa o CPF se o cadastro não tinha.
- **`create`, `search`** (nome parcial ou CPF completo de 11 dígitos, mínimo 2 caracteres), **`get`** (`?reveal=true` só para gerente/admin; audita `consumer.cpf_reveal`; inclui últimas 20 comandas), **`update`** (nome/CPF com `reason` obrigatório; audita antes/depois **mascarados**).
- CPF nunca é retornado completo fora do `reveal`.

## catalog — `modules/catalog/catalog.module.ts`

- `EFFECTIVE_PRICE` (SQL exportado): preço promocional se `now()` está entre `promo_starts_at` e `promo_ends_at`; senão `price_cents`. **Usado também no lançamento**, garantindo que o preço cobrado é o mostrado.
- `list` (filtros `active=true`, `category`, `q`, `for_terminal=true` → só produtos liberados para o setor do terminal da requisição), `categories`, `create`, `update` (parcial; grava `product_prices` e audita `product.price_change` quando preço/promoção mudam), `prices`.
- Alterar preço **não** altera itens já lançados.

## orders — `modules/orders/orders.module.ts`

- **`launch(ctx, tabId, idempotencyKey, {items:[{product_id, quantity, note?}]})`** (1–50 itens, quantidade 1–999):
  1. exige `Idempotency-Key` (8–100 caracteres; `requireKey` exportado e reutilizado em pagamentos);
  2. trava a comanda;
  3. **replay:** se já existem itens com `batch_key = chave` → devolve o resultado original (`replayed:true`); se a chave pertence a outra comanda → 409 `IDEMPOTENCIA_CONFLITO`;
  4. exige `status='aberta'` (409 `COMANDA_NAO_ABERTA`, com mensagem por estado);
  5. carrega produtos ativos do estabelecimento (422 `PRODUTO_INDISPONIVEL`) e, se há terminal, valida setor (422 `PRODUTO_NAO_DISPONIVEL_NO_SETOR`);
  6. insere cada item com **descrição e preço vigentes copiados** (`line_no` sequencial); audita `item.launch`.
- `list`: itens da comanda com filtros `status`, `product_id`, `terminal_id`, `from`, `to`.

## adjustments — `modules/adjustments/adjustments.module.ts`

- Estados que aceitam ajuste: `aberta`, `em_conferencia`, `aguardando_pagamento`, `parcialmente_paga` (409 `COMANDA_NAO_EDITAVEL`).
- Autoridade exigida: `supervisor`, `gerente`, `admin` — ou aprovação (`ApprovalService`).
- **Cancelamento** (`item_id`, `reason`): trava o item; deve estar `valido`; marca `cancelado` (quem, quando, motivo) e cria `tab_adjustments` com o subtotal. O item **continua visível**.
- **Desconto** (`amount_cents` **ou** `percent`, `reason`): percentual calculado sobre o consumo bruto atual e **convertido em centavos fixos**; rejeita zero ou total de descontos > consumo (422); se a autoridade efetiva for `supervisor` e o desconto total passar de `max_discount_bps` do consumo → exige gerente/admin (403 `DESCONTO_ACIMA_DO_LIMITE`).
- **`revoke`**: marca desconto como revertido (`revoked_*`), nunca apaga.
- Ao final: `refreshStatus` + auditoria com totais antes/depois.

## checkout — `modules/checkout/checkout.module.ts`

- **`statement`**: monta o extrato **no servidor** (comanda, todos os itens inclusive cancelados, ajustes, pagamentos, estornos). Nunca usa total vindo do front.
- **`checkout`**: `aberta` → `em_conferencia` (grava `checked_by/at`); idempotente se já em estados financeiros; 409 se `bloqueada`/inválida.
- **`confirmStatement`**: cliente conferiu → `aguardando_pagamento` (grava `statement_confirmed_at`).
- **`resume`**: volta para `aberta` **somente sem pagamentos confirmados/pendentes**.
- **`close`**: exige estado financeiro (senão 409 `CONFERENCIA_PENDENTE`). *Normal* = `balance=0` e `pending=0`. Caso contrário 409 `SALDO_PENDENTE`; com `exception:{reason}` exige gerente/admin (via aprovação), cancela pagamentos pendentes, grava `close_exception` e audita `tab.close_exception`.
- **`reopen`**: só `encerrada`; autoridade supervisor/gerente/admin (ou aprovação); zera dados de fechamento/conferência, incrementa `reopen_count`, audita `tab.reopen`. Falha com `COMANDA_OCUPADA` se o número foi reaproveitado.

## payments — `modules/payments/payments.module.ts`

- **`create(ctx, tabId, key, corpo)`** — validações nesta ordem: trava → replay por `idempotency_key` → estado em {`em_conferencia`,`aguardando_pagamento`,`parcialmente_paga`} (409 `COMANDA_NAO_PAGAVEL`) → operador com caixa aberto (409 `CAIXA_FECHADO`) → saldo disponível = `balance − pending` > 0 (422 `SEM_SALDO`) → valor ≤ disponível (422 `VALOR_EXCEDE_SALDO`) → `allow_partial_payment` (se `false`, valor deve ser o saldo todo) → referência (≥ 3 caracteres) obrigatória fora do dinheiro → `cash_received_cents ≥ amount` → grava. **Dinheiro nunca fica pendente.** Para não-dinheiro, `status:'pendente'` opcional. Vincula ao caixa aberto do operador, recalcula estado, audita `payment.create`. Resposta traz `change_cents` (troco).
- **`transition(confirm|reject|cancel)`**: só `pendente`; `confirm` exige referência; `reject/cancel` exigem motivo. Lê o pagamento, **trava a comanda**, relê o pagamento `FOR UPDATE` (ordem de travas segura).
- **`refund`**: pagamento `confirmado` → `estornado` (estorno **total**); não permitido com comanda `encerrada` (reabra antes); autoridade gerente/admin ou aprovação; grava `payment_refunds` ligado ao caixa aberto do operador.
- Cartão/Pix **nunca** guardam dados sensíveis: só `reference`.

## cash-register — `modules/cash-register/cash-register.module.ts`

- **`open`** (`opening_cents`): um por usuário (409 `CAIXA_JA_ABERTO`).
- **`summary`**: recebimentos confirmados do turno por forma; **dinheiro esperado = troco inicial + dinheiro recebido − estornos em dinheiro do turno**; pagamentos pendentes do turno.
- **`close`** (`counted_cents`): bloqueado se há pagamentos pendentes no turno (409 `PAGAMENTOS_PENDENTES`); grava esperado, contado e diferença; audita `cash.close`.
- **`sessions`**: operador vê os próprios turnos; supervisor/gerente/admin/auditor veem todos.

## establishments — `modules/establishments/establishments.module.ts`

- `get/update` do próprio estabelecimento (valida `number_min ≤ number_max`).
- `listAll/createEstablishment` (somente admin): cria estabelecimento + gerente inicial + terminal "Caixa 1".
- **Eventos:** `events`, `createEvent`, `closeEvent` (409 `EVENTO_COM_COMANDAS_ATIVAS` se ainda há comandas ativas).
- **Terminais:** `terminals`, `createTerminal`, `updateTerminal`.

## users — `modules/users/users.module.ts`

Somente admin/gerente. Gerente não cria nem altera admin. Ninguém altera o próprio perfil nem se desativa. Troca de perfil audita `user.permission_change`; troca de senha por admin/gerente audita `user.password_reset`. A resposta nunca inclui `password_hash`.

## reports — `modules/reports/reports.module.ts`

- **`summary`** (filtros `from`, `to` = `YYYY-MM-DD`, `event_id`; padrão: últimos 30 dias): executa 12 consultas em paralelo: vendas por dia/produto/categoria/terminal, comandas por situação, pagamentos por forma×situação, ticket médio (comandas encerradas), descontos, cancelamentos, estornos, exceções/reaberturas, divergências (encerradas com saldo ≠ 0).
- **`cashClosings`**: turnos de caixa no período.
- **`exportCsv`** (`type` = `products` | `payments` | `tabs`): CSV com `;` e vírgula decimal (abre direto no Excel pt-BR), BOM UTF-8; **sem CPF**; audita `report.export`.
