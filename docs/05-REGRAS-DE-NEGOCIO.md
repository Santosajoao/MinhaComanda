# 05 — Regras de negócio

## 1. Estados da comanda e transições

```
                    ┌──────────── block ───────────┐
                    ▼                              │
 (abertura) ──► aberta ◄──── unblock ──── bloqueada
                │  ▲  └── cancel (sem consumo/pagamento) ──► cancelada (final)
        checkout│  │resume (só sem pagamentos)
                ▼  │
          em_conferencia ──confirm-statement──► aguardando_pagamento
                │                                   │
                └────── pagamentos confirmados ─────┤
                                 ▼                  ▼
                         parcialmente_paga ◄──► paga        (automático: refreshStatus)
                                 └────────┬────────┘
                                          ▼  close
                                      encerrada ──reopen (autorizado)──► aberta
```

| Estado | Lançar itens | Cancelar item / desconto | Receber pagamento | Encerrar | Estornar |
|---|---|---|---|---|---|
| `aberta` | ✔ | ✔ | ✘ (inicie a conferência) | ✘ `CONFERENCIA_PENDENTE` | — |
| `bloqueada` | ✘ | ✘ | ✘ | ✘ | — |
| `em_conferencia` | ✘ | ✔ | ✔ | ✔ se saldo 0 | ✔ |
| `aguardando_pagamento` | ✘ | ✔ | ✔ | ✔ se saldo 0 | ✔ |
| `parcialmente_paga` | ✘ | ✔ | ✔ | ✔ se saldo 0 (ou exceção) | ✔ |
| `paga` | ✘ | ✘ | ✘ (sem saldo) | ✔ | ✔ |
| `encerrada` | ✘ | ✘ | ✘ | — | ✘ (reabra antes) |
| `cancelada` | ✘ | ✘ | ✘ | — | — |

A transição é sempre validada no servidor; o banco reforça "só lança item em comanda `aberta`".

## 2. Recálculo automático do estado financeiro

`TabsService.refreshStatus` roda depois de qualquer mudança em descontos, cancelamentos ou pagamentos, **apenas** nos estados `em_conferencia`, `aguardando_pagamento`, `parcialmente_paga`, `paga`:

1. `balance = 0` **e** `pending = 0` → `paga`
2. senão, `paid > 0` → `parcialmente_paga`
3. senão, se estava `paga`/`parcialmente_paga` (ex.: após estorno) → volta a `aguardando_pagamento` (se o cliente já tinha confirmado o extrato) ou `em_conferencia`
4. senão, mantém.

Observações: comanda sem consumo (total 0) vai a `paga` na primeira recalculação; saldo **negativo** (pago a maior, p.ex. cancelou item depois de pagar) fica `parcialmente_paga` e **impede o fechamento normal** até estornar o excedente.

## 3. Cálculo financeiro

Definido em SQL (`tab_totals`, ver [02 §5](02-BANCO-DE-DADOS.md#5-função-tab_totalsp_tab-uuid--fonte-única-da-verdade-rn-06)):

```
consumo bruto  = Σ itens válidos
desconto       = min(Σ descontos não revertidos, consumo bruto)
taxa           = round((bruto − desconto) × service_fee_bps / 10000)     (bps copiado na abertura)
total devido   = bruto − desconto + taxa
pago           = Σ pagamentos confirmados
pendente       = Σ pagamentos pendentes (NÃO abate o saldo)
saldo          = total devido − pago
```

- **Consumo × pagamento × saldo** são conceitos distintos (documento §3.7).
- Cancelamento de item, estorno de pagamento e reembolso são operações diferentes, cada uma com registro próprio.
- Pagamento novo é limitado a `saldo − pendente` (o que está pendente "reserva" parte do saldo).

## 4. Numeração das comandas

| Configuração (`establishments`) | Efeito |
|---|---|
| `number_mode = auto` | Sem número informado, o sistema escolhe o **menor livre** na faixa. Número informado também é aceito (cartões físicos). |
| `number_mode = manual` | Número é obrigatório. |
| `number_min / number_max` | Faixa válida; fora dela → 422. |
| `number_pad` | Zeros à esquerda (`5` → `00428`). Buscas aceitam `428`. |
| `number_reuse = true` (padrão) | Número livre assim que a comanda é encerrada/cancelada. |
| `number_reuse = false` | Número usado em um evento fica indisponível até o fim do evento. |

A unicidade garantida pelo banco é entre comandas **ativas** do mesmo estabelecimento. Histórico de comandas encerradas com o mesmo número é preservado (a busca por número devolve a ativa, ou a mais recente).

## 5. Política de CPF

`cpf_policy`: `optional` (padrão), `required`, `none` (ignora CPF informado). O CPF **nunca** é chave, número de conta, código de pagamento ou campo obrigatório de busca; só identifica o consumidor recorrente. Mesmo CPF em nova comanda reaproveita o cadastro.

## 6. Autorizações

### 6.1 Perfis por operação

| Operação | Perfis diretos | Alternativa |
|---|---|---|
| Abrir comanda | recepcao, caixa, supervisor, gerente, admin | — |
| Lançar consumo | atendente, caixa, supervisor, gerente, admin | — |
| Conferência, receber pagamento, encerrar | caixa, supervisor, gerente, admin | — |
| Cancelar item / aplicar desconto / reverter desconto | supervisor, gerente, admin | outro perfil + credenciais de supervisor+ |
| Desconto acima do limite do supervisor | gerente, admin | credenciais de gerente/admin |
| Reabrir comanda encerrada | supervisor, gerente, admin | credenciais de supervisor+ |
| Estornar pagamento | gerente, admin | credenciais de gerente/admin |
| Encerrar com exceção (saldo/pendência) | gerente, admin | credenciais de gerente/admin |
| Cancelar abertura da comanda | supervisor, gerente, admin | credenciais de supervisor+ |
| Bloquear / desbloquear | supervisor, gerente, admin | — |
| Ver CPF completo | gerente, admin (auditado) | — |
| Produtos, usuários, configurações, eventos, terminais | gerente, admin | — |
| Criar estabelecimento / administrador | admin | — |
| Relatórios | gerente, admin, auditor, supervisor | — |
| Exportar CSV | gerente, admin | — |
| Auditoria | gerente, admin, auditor | — |

### 6.2 Autorização adicional (aprovação)

Fluxo: a chamada falha com 403 `APROVACAO_NECESSARIA` → o front abre o diálogo → o autorizador digita e-mail/senha → a **mesma chamada** é repetida com `approval`. O backend valida (mesmo estabelecimento, ativo, perfil permitido, senha) e grava `approved_by`. Falhas viram `auth.approval_denied` na auditoria.

### 6.3 Limite de desconto

`max_discount_bps` (padrão 1000 = 10%) vale para a autoridade efetiva **supervisor**: o desconto **acumulado** da comanda não pode passar dessa fração do consumo bruto. Acima disso só gerente/admin.

## 7. Pagamentos

- Formas: dinheiro, Pix, débito, crédito, outro.
- Pagamento combinado e parcial: vários pagamentos somam o saldo. `allow_partial_payment=false` exige um único pagamento do saldo inteiro.
- Estados: `pendente` → `confirmado` / `recusado` / `cancelado`; `confirmado` → `estornado`.
- Dinheiro entra sempre `confirmado`; troco = recebido − valor (informativo, não persistido como pagamento).
- Referência da transação obrigatória fora do dinheiro.
- Exige caixa aberto do operador (todos os pagamentos entram no turno).
- Estorno só do valor total do pagamento; não vale para comanda encerrada.
- O sistema **não** processa pagamentos com provedores: o caixa registra o que ocorreu na maquininha/Pix.

## 8. Fechamento

- **Normal:** saldo = 0 e nenhum pagamento pendente.
- **Exceção administrativa:** motivo obrigatório + gerente/admin; pagamentos pendentes viram `cancelado`; fica em `close_exception`, aparece em *Divergências* e na auditoria (`tab.close_exception`).
- **Reabertura:** motivo obrigatório + supervisor+; preserva todo o histórico; `reopen_count` aumenta.

## 9. Caixa

Um turno aberto por operador. Esperado em dinheiro = troco inicial + dinheiro recebido − estornos em dinheiro. Fechamento registra contado e diferença; bloqueado com pagamentos pendentes no turno.

## 10. Mapa de requisitos → implementação

### Regras de negócio obrigatórias (documento §4)

| Regra | Onde está |
|---|---|
| RN-01 UUID + número visível | `tabs.id`, `tabs.number` |
| RN-02 CPF/nome não identificam a comanda | tabela `consumers` separada; `tabs.consumer_id` opcional |
| RN-03 número único entre ativas | índice `uq_tabs_active_number` + checagem amigável em `TabsService.open` |
| RN-04 comanda aberta com estado e registro de abertura | `status` com CHECK; `opened_by/opened_at` NOT NULL |
| RN-05 preço preservado | cópia no `launch` + trigger `trg_items_immutable` |
| RN-06 total vem de lançamentos e ajustes válidos | função `tab_totals`; front não envia total |
| RN-07 operação repetida não duplica | `Idempotency-Key` → `tab_items(batch_key,line_no)` e `payments.idempotency_key` |
| RN-08 ajustes preservam histórico | itens cancelados continuam; descontos revertidos continuam; triggers contra DELETE |
| RN-09 concorrência | `SELECT … FOR UPDATE` na comanda dentro de transação |
| RN-10 encerrada não aceita lançamento | checagem em `OrdersService.launch` + trigger `trg_items_open_tab` |
| RN-11 pendente ≠ confirmado | `tab_totals` só abate `confirmado` |
| RN-12 fechamento normal exige saldo 0 | `CheckoutService.close` |
| RN-13 estorno e reabertura autorizados e auditados | `ApprovalService` + `audit.log` |
| RN-14 acesso por estabelecimento e perfil | `ctx.user.establishmentId` em todas as consultas + `AuthGuard` |
| RN-15 histórico preservado | nada é apagado; triggers de imutabilidade |

### Requisitos funcionais (documento §3)

| RF | Módulo | Situação |
|---|---|---|
| RF-01 Consumidor (nome, CPF validado/mascarado, correção auditada, minimização) | `consumers` | Completo |
| RF-02 Numeração e abertura | `tabs`, `establishments` | Completo, **exceto** RF-02.09 (devolução de cartões/pulseiras reutilizáveis — não há controle de estoque físico) |
| RF-03 Estados | `tabs`, `checkout` | Completo (estado "Disponível" não existe: o número livre é implícito) |
| RF-04 Produtos | `catalog` | Completo, **exceto** adicionais/variações/combos (cadastre como produtos) e integração com estoque/PDV |
| RF-05 Consumo | `orders` | Completo, **exceto** RF-05.08 (modo offline/sincronização) |
| RF-06 Conferência | `checkout` | Completo |
| RF-07 Pagamentos | `payments`, `cash-register` | Completo como **registro**; sem conciliação automática com provedor |
| RF-08 Cancelamentos/descontos | `adjustments` | Completo |
| RF-09 Usuários/permissões | `users`, `auth` | Completo, sem MFA |
| RF-10 Relatórios | `reports` | Completo |
| RF-11 Administração | `establishments`, `catalog`, `users` | Completo |
| RF-12 Auditoria | `audit` | Completo |
