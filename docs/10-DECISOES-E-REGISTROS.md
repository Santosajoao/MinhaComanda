# 10 — Decisões de projeto, limitações e glossário

## 1. Registro de decisões (ADR)

| # | Decisão | Motivo | Consequência |
|---|---|---|---|
| 1 | **Monólito modular** (NestJS + PostgreSQL) | Documento §6: transações consistentes comanda/consumo/pagamento, simplicidade | Uma implantação; divida em serviços só com necessidade comprovada |
| 2 | **Driver `pg` com SQL explícito**, sem Prisma | O ambiente de desenvolvimento não conseguia baixar os binários do Prisma, impedindo testar; SQL dá controle direto de travas/transações (o documento já prevê SQL para concorrência) | Sem geração de tipos/migrações do ORM; migrações em SQL puro. Migrar para Prisma é possível mantendo `migrations/` e `tab_totals` |
| 3 | **Totais calculados por função SQL** (`tab_totals`) | Fonte única da verdade (RN-06); usada em telas e relatórios | Alterar regra = nova migração; nunca duplicar a conta em TypeScript |
| 4 | **Dinheiro em centavos inteiros** | Evita erros de ponto flutuante (documento §8.5) | Front formata na borda |
| 5 | **Idempotência com chaves persistidas** nas próprias tabelas (`batch_key`, `idempotency_key`) | RN-07; resposta repetida devolve o original | Cliente deve reusar a chave ao reenviar |
| 6 | **Trava por linha da comanda** (`FOR UPDATE`) | RN-09 sem fila/cache | Operações da mesma comanda são sequenciais; comandas diferentes escalam em paralelo |
| 7 | **Histórico imutável + compensação**, reforçado por **triggers** | RN-08/RN-15 mesmo contra erro de código ou acesso direto ao banco | Correção manual exige desabilitar trigger conscientemente |
| 8 | **CPF criptografado (AES-GCM) + HMAC para busca** | LGPD/minimização; achar consumidor recorrente sem expor | Dependência de `DATA_KEY`; mesma chave em duas funções |
| 9 | **Autorização adicional por credenciais** (em vez de PIN/QR) | Operação real: supervisor digita login no terminal do caixa | Auditoria registra quem pediu e quem aprovou |
| 10 | **Pagamentos apenas registrados** (sem integrar adquirente) | Decisão do documento §18 deixada em aberto; escolheu-se o caminho sem dependência externa | Conciliação com a maquininha é manual; modelo pronto para provedor (ver [09 §6.9](09-OPERACAO-E-MANUTENCAO.md)) |
| 11 | **Número visível separado do UUID; unicidade só entre ativas** | Documento §3.2/§8.4; permite reuso; configurável (`number_reuse`) | Busca por número devolve a ativa ou a mais recente |
| 12 | **Taxa de serviço copiada para a comanda** (`tabs.service_fee_bps`) | Mudar a configuração não altera comandas já abertas (mesmo espírito da RN-05) | |
| 13 | **Pagamento permitido já em `em_conferencia`**; `confirm-statement` marca o aceite do cliente | Fluxo rápido no caixa sem perder o registro da conferência | `aguardando_pagamento` pode ser pulado se o caixa receber logo |
| 14 | **Desconto em percentual vira centavos fixos** no momento da aplicação | Valor auditável e estável mesmo se o consumo mudar depois | Cancelar item depois pode deixar o desconto proporcionalmente maior (limitado ao consumo) |
| 15 | **Estorno somente total** | Simplicidade e rastreabilidade na v1.0 | Estorno parcial = estornar e registrar novo pagamento |
| 16 | **Caixa aberto obrigatório para receber** | Fechamento por operador/turno (RF-07.09) | Operador precisa abrir caixa antes |
| 17 | **JWT em `localStorage`** | Simplicidade em app de rede interna | Avaliar cookies `HttpOnly` + proteção CSRF para exposição pública |
| 18 | **Rate limit de login em memória** | Proteção básica sem infraestrutura extra | Não compartilha entre instâncias |

## 2. Decisões em aberto do documento (§18) e o que foi adotado

| Pergunta | Adotado na v1.0 | Como mudar |
|---|---|---|
| Numeração (física/automática) | Ambas, por configuração (`number_mode`) | Tela *Configurações* |
| Reutilização do número | Reutilizável após encerrar; opção de bloquear no evento | `number_reuse` |
| Identificação física (cartão/pulseira/QR) | Apenas número digitado/impresso; sem RFID/NFC/QR | Nova integração (leitor envia o número ao campo) |
| CPF | Opcional (configurável: obrigatório/não coletar) | `cpf_policy` |
| Pagamentos | Registro manual com referência | ADR 10 |
| Operação offline | **Não** — sem conexão a operação falha com aviso; reenviar com a mesma chave é seguro | Projeto específico (fila local, ids no dispositivo, conflitos) |
| Escala | Não validada em carga | Teste com volume real |
| Integrações (PDV, estoque, fiscal, impressora térmica) | Nenhuma; impressão via navegador | Módulo `integrations` futuro |

## 3. Limitações conhecidas (v1.0.0)

- Sem MFA, sem Swagger/OpenAPI, sem Dockerfiles/CI de produção, sem Redis.
- Sem modo offline, RFID/NFC, emissão fiscal, impressora térmica, estoque.
- Variações/adicionais/combos: cadastrar como produtos separados.
- Estorno apenas total; sem rotina de retenção/anonimização de dados pessoais.
- Sem recuperação de senha por e-mail (redefinição por gerente/admin).
- Sem paginação nas listagens (limites fixos: comandas ≤ 500, auditoria ≤ 500, `before_id` na auditoria).
- Teste de carga e teste de restauração de backup pendentes.
- Relatórios agrupam por data no fuso `America/Sao_Paulo` fixo.

## 4. Glossário

| Termo | Significado |
|---|---|
| Comanda (`tab`) | Conta de consumo identificada por número próprio |
| Número visível | Texto exibido ao operador (`00428`); não é a chave interna |
| Consumo bruto | Soma dos itens válidos |
| Saldo | Total devido − pagamentos confirmados |
| Pendente | Pagamento registrado e ainda não confirmado; não abate saldo |
| Conferência | Revisão do extrato com o consumidor antes do pagamento |
| Exceção administrativa | Encerramento com saldo/pendência, autorizado e auditado |
| Autorização adicional (aprovação) | Credenciais de supervisor/gerente informadas para completar uma operação |
| Idempotência | Repetir a mesma requisição não repete o efeito |
| Estorno | Devolução de um pagamento confirmado (diferente de cancelar consumo) |
| bps | pontos-base: 100 = 1%; 1000 = 10% |
| PDV / terminal | Dispositivo ou ponto de venda que origina a operação |
| Turno de caixa | Período entre abertura e fechamento do caixa de um operador |
| RN / RF / RNF | Regra de negócio / requisito funcional / requisito não funcional do documento v1.0 |
