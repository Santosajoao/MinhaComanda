# 04 — Referência da API

Base: `http://localhost:3001/api/v1`. JSON em UTF-8.

## Cabeçalhos

| Cabeçalho | Quando | Descrição |
|---|---|---|
| `Authorization: Bearer <token>` | todas, exceto `POST /auth/login` e `GET /health` | JWT obtido no login (validade 10 h) |
| `Idempotency-Key: <8–100 caracteres>` | **obrigatório** em `POST /tabs/:id/items` e `POST /tabs/:id/payments` | Repetir a mesma chave devolve o resultado original sem duplicar. Gere uma chave nova por operação legítima (ex.: UUID) e **reutilize-a ao reenviar após falha de rede**. |
| `X-Terminal-Id: <uuid>` | opcional | Terminal/PDV do dispositivo; gravado em itens, pagamentos e caixa; define o setor para filtrar produtos |
| `X-Request-Id` | opcional | Se omitido, a API gera um; é devolvido na resposta e gravado na auditoria |

## Formato de erro

```json
{ "error": { "code": "COMANDA_OCUPADA", "message": "A comanda 00428 já está aberta", "details": null, "requestId": "…" } }
```

`details` traz as falhas de validação quando `code = VALIDACAO`.

## Perfis e atalhos usados abaixo

`CAIXA+` = caixa, supervisor, gerente, admin · `OPER` = recepcao, caixa, supervisor, gerente, admin · `SUP+` = supervisor, gerente, admin · `GER` = gerente, admin · "todos" = qualquer usuário autenticado.

## Autenticação e perfil

| Método | Rota | Perfis | Corpo / observações |
|---|---|---|---|
| POST | `/auth/login` | público | `{email, password}` → `{token, user, establishment, cashSession}` (200). 401 `CREDENCIAIS_INVALIDAS`; 429 `MUITAS_TENTATIVAS` |
| GET | `/auth/me` | todos | usuário, configurações do estabelecimento, caixa aberto |
| PATCH | `/auth/password` | todos | `{current_password, new_password (≥8)}` |
| GET | `/health` | público | `{status, database, time}` |

## Comandas

| Método | Rota | Perfis | Corpo / resposta |
|---|---|---|---|
| POST | `/tabs` | OPER | `{number?, name?, cpf?, consumer_id?, event_id?}` → comanda (201). Sem `number`: automático (modo `auto`). |
| GET | `/tabs?status=a,b&q=&event_id=&limit=` | todos | lista com totais |
| GET | `/tabs/:key` | todos | `:key` = UUID **ou número** (`428`, `00428`) |
| POST | `/tabs/:id/block` · `/unblock` | SUP+ | `{reason}` |
| POST | `/tabs/:id/cancel` | OPER | `{reason, approval?}` cancela a abertura (sem consumo/pagamento) |

Resposta de comanda (`tab`):
```json
{ "id":"…","number":"00428","status":"aberta","establishment_name":"…","event_name":"…",
  "opened_at":"…","opened_by_name":"…","checked_at":null,"closed_at":null,"close_exception":null,"reopen_count":0,
  "service_fee_bps":0,
  "consumer":{"id":"…","name":"João da Silva","cpf_masked":"***.982.247-**"},
  "totals":{"gross_cents":9500,"cancelled_cents":0,"discount_cents":0,"fee_cents":0,"net_cents":9500,"paid_cents":0,"pending_cents":0,"balance_cents":9500} }
```

## Consumo

| Método | Rota | Perfis | Corpo / resposta |
|---|---|---|---|
| POST | `/tabs/:id/items` | atendente, caixa, supervisor, gerente, admin | `{items:[{product_id, quantity, note?}]}` + `Idempotency-Key` → `{replayed, items[], tab}` (200). **Não envie preço.** |
| GET | `/tabs/:id/items?status=&product_id=&terminal_id=&from=&to=` | todos | itens (inclui cancelados) |

## Ajustes

| Método | Rota | Perfis | Corpo |
|---|---|---|---|
| POST | `/tabs/:id/adjustments` | atendente, caixa, recepcao, SUP+ | `{type:'cancelamento', item_id, reason, approval?}` **ou** `{type:'desconto', amount_cents? \| percent?, reason, approval?}` → `{adjustment, tab}` (201) |
| POST | `/tabs/:id/adjustments/:adjId/revoke` | CAIXA+ | `{reason, approval?}` reverte um desconto |

`approval = {email, password}` de um supervisor/gerente/admin do mesmo estabelecimento. Sem o perfil exigido e sem `approval` → 403 `APROVACAO_NECESSARIA`.

## Conferência, fechamento e ciclo de vida

| Método | Rota | Perfis | Resposta |
|---|---|---|---|
| GET | `/tabs/:id/statement` | todos | `{tab, items, adjustments, payments, refunds, generated_at, generated_by}` (aceita número no lugar do id) |
| POST | `/tabs/:id/checkout` | CAIXA+ | extrato; `aberta → em_conferencia` |
| POST | `/tabs/:id/confirm-statement` | CAIXA+ | extrato; cliente conferiu → `aguardando_pagamento` |
| POST | `/tabs/:id/resume` | CAIXA+ | comanda; volta a `aberta` (sem pagamentos) |
| POST | `/tabs/:id/close` | CAIXA+ | `{}` ou `{exception:{reason}, approval?}` → extrato |
| POST | `/tabs/:id/reopen` | CAIXA+ (exige autoridade SUP+ via perfil ou `approval`) | `{reason, approval?}` → comanda |

## Pagamentos

| Método | Rota | Perfis | Corpo / resposta |
|---|---|---|---|
| POST | `/tabs/:id/payments` | CAIXA+ | `{method:'dinheiro'\|'pix'\|'debito'\|'credito'\|'outro', amount_cents, status?:'confirmado'\|'pendente', reference?, cash_received_cents?}` + `Idempotency-Key` → `{replayed, payment, change_cents, tab}` (200) |
| GET | `/tabs/:id/payments` | todos | lista |
| POST | `/payments/:id/confirm` | CAIXA+ | `{reference?}` (pendente → confirmado) |
| POST | `/payments/:id/reject` · `/cancel` | CAIXA+ | `{reason}` (≥ 3 caracteres) |
| POST | `/payments/:id/refunds` | CAIXA+ (exige GER via perfil ou `approval`) | `{reason, approval?}` → `{refund, tab}` (201); estorno total |

## Caixa

| Método | Rota | Perfis | Descrição |
|---|---|---|---|
| POST | `/cash-register/open` | CAIXA+ | `{opening_cents}` → resumo (201) |
| GET | `/cash-register/current` | CAIXA+ | resumo do turno aberto ou `null` |
| POST | `/cash-register/close` | CAIXA+ | `{counted_cents, notes?}` → resumo com esperado/contado/diferença |
| GET | `/cash-register/sessions` | CAIXA+, auditor | turnos (operador vê só os seus) |

## Cadastros

| Método | Rota | Perfis | Observações |
|---|---|---|---|
| GET | `/products?active=true&category=&q=&for_terminal=true` | todos | inclui `effective_price_cents` e `promo_now` |
| GET | `/products/categories` | todos | |
| POST / PATCH | `/products` · `/products/:id` | GER | `{code, name, category, unit, price_cents, active, sectors[], promo_price_cents?, promo_starts_at?, promo_ends_at?}` (datas ISO com fuso) |
| GET | `/products/:id/prices` | GER, auditor | histórico de preços |
| POST | `/consumers` | OPER | `{name, cpf?}` |
| GET | `/consumers?q=` | OPER | busca por nome ou CPF completo |
| GET | `/consumers/:id?reveal=true` | OPER, auditor | CPF completo só gerente/admin (auditado) |
| PATCH | `/consumers/:id` | OPER | `{name?, cpf?, reason}` |
| GET / POST / PATCH | `/users` · `/users/:id` | GER | `{name, email, password, role}`; PATCH `{name?, role?, active?, password?}` |
| GET / PATCH | `/establishment` | GET todos; PATCH GER | configurações (numeração, CPF, taxa, limite de desconto, pagamento parcial) |
| GET / POST | `/admin/establishments` | admin | cria estabelecimento + gerente `{name, manager:{name,email,password}}` |
| GET / POST | `/events` · POST `/events/:id/close` | GET todos; POST GER | |
| GET / POST / PATCH | `/terminals` · `/terminals/:id` | GET todos; escrita GER | |

## Relatórios e auditoria

| Método | Rota | Perfis |
|---|---|---|
| GET | `/reports/summary?from=&to=&event_id=` | GER, auditor, supervisor |
| GET | `/reports/cash-closings?from=&to=` | GER, auditor, supervisor |
| GET | `/reports/export?type=products\|payments\|tabs&from=&to=&event_id=` | GER (CSV) |
| GET | `/audit-events?type=&user_id=&entity_id=&from=&to=&limit=&before_id=` | GER, auditor |

## Códigos de erro

| HTTP | Código | Significado |
|---|---|---|
| 400 | `VALIDACAO` | corpo inválido (detalhes em `details`) |
| 400 | `REQUISICAO_INVALIDA`, `JSON_INVALIDO`, `DADO_INVALIDO` | requisição/identificador malformado |
| 400 | `CPF_INVALIDO`, `CPF_OBRIGATORIO`, `NOME_OBRIGATORIO` | cadastro do consumidor |
| 400 | `NUMERO_INVALIDO`, `NUMERO_OBRIGATORIO` | número da comanda |
| 400 | `IDEMPOTENCY_KEY_OBRIGATORIA` | faltou cabeçalho |
| 400 | `TERMINAL_INVALIDO`, `TIPO_INVALIDO` | terminal inexistente/inativo; tipo de exportação |
| 401 | `NAO_AUTENTICADO`, `SESSAO_EXPIRADA`, `USUARIO_INATIVO`, `CREDENCIAIS_INVALIDAS` | sessão/login |
| 403 | `SEM_PERMISSAO` | perfil sem acesso |
| 403 | `APROVACAO_NECESSARIA` / `APROVACAO_INVALIDA` | falta/errou a autorização adicional |
| 403 | `DESCONTO_ACIMA_DO_LIMITE` | desconto acima do limite do supervisor → gerente/admin |
| 403 | `SENHA_INCORRETA` | senha atual errada |
| 404 | `NAO_ENCONTRADO` | registro inexistente **ou de outro estabelecimento** |
| 409 | `COMANDA_OCUPADA`, `NUMERO_JA_UTILIZADO_NO_EVENTO`, `SEM_NUMEROS_DISPONIVEIS` | numeração |
| 409 | `COMANDA_NAO_ABERTA`, `COMANDA_NAO_EDITAVEL`, `COMANDA_NAO_PAGAVEL`, `COMANDA_BLOQUEADA`, `COMANDA_ENCERRADA`, `COMANDA_COM_MOVIMENTO`, `COMANDA_COM_PAGAMENTOS`, `ESTADO_INVALIDO`, `CONFERENCIA_PENDENTE` | operação incompatível com o estado |
| 409 | `SALDO_PENDENTE` | fechamento normal com saldo ≠ 0 ou pendências |
| 409 | `CAIXA_FECHADO`, `CAIXA_JA_ABERTO`, `PAGAMENTOS_PENDENTES` | caixa |
| 409 | `PAGAMENTO_NAO_PENDENTE`, `PAGAMENTO_NAO_CONFIRMADO`, `ITEM_JA_CANCELADO`, `AJUSTE_NAO_REVERSIVEL` | transições inválidas |
| 409 | `IDEMPOTENCIA_CONFLITO` | chave de idempotência já usada em outra comanda |
| 409 | `CPF_DUPLICADO`, `EMAIL_EM_USO`, `EVENTO_COM_COMANDAS_ATIVAS`, `REFERENCIA_INVALIDA`, `CONFLITO` | unicidade/integridade |
| 409 | `REGRA_DE_NEGOCIO` | bloqueio vindo de trigger do banco (mensagem do trigger) |
| 422 | `NUMERO_FORA_DA_FAIXA`, `FAIXA_INVALIDA`, `EVENTO_INVALIDO` | configuração |
| 422 | `PRODUTO_INDISPONIVEL`, `PRODUTO_NAO_DISPONIVEL_NO_SETOR` | produto |
| 422 | `DESCONTO_INVALIDO`, `DESCONTO_EXCEDE_CONSUMO` | descontos |
| 422 | `SEM_SALDO`, `VALOR_EXCEDE_SALDO`, `PAGAMENTO_PARCIAL_NAO_PERMITIDO`, `REFERENCIA_OBRIGATORIA`, `VALOR_RECEBIDO_INSUFICIENTE`, `MOTIVO_OBRIGATORIO` | pagamentos |
| 422 | `RESTRICAO_VIOLADA` | CHECK do banco |
| 429 | `MUITAS_TENTATIVAS` | limite de login |
| 503 | `TENTE_NOVAMENTE` | deadlock/serialização (repita a operação) |
| 500 | `ERRO_INTERNO` | falha inesperada (use o `requestId` para achar o log) |
