# 07 — Segurança, privacidade e LGPD

## 1. Autenticação

- Usuário individual (e-mail + senha). Senhas com **bcrypt (custo 10)**; mínimo 8 caracteres.
- JWT assinado (`JWT_SECRET`), validade de 10 h, contendo apenas `sub` e `role`. **O perfil real é lido do banco a cada requisição**, então desativar um usuário ou mudar seu perfil vale imediatamente.
- Proteção contra força bruta: 8 falhas por `email|IP` em 15 minutos → 429. Limitação: contador **em memória** (zera ao reiniciar; não é compartilhado entre várias instâncias da API). Para produção com várias instâncias, mova para Redis/banco ou use o WAF/proxy.
- **Não há MFA.** O documento recomenda MFA para administradores; é um item pendente (ver [10](10-DECISOES-E-REGISTROS.md)).

## 2. Autorização

1. `@Roles()` em cada endpoint (verificado no servidor, nunca só no front).
2. **Isolamento por estabelecimento:** toda consulta inclui `establishment_id = ctx.user.establishmentId`; recursos de outro estabelecimento respondem 404. Testado (seção 11 do e2e).
3. **Autorização adicional** com credenciais de supervisor/gerente para operações sensíveis (ver [05 §6](05-REGRAS-DE-NEGOCIO.md#6-autorizações)).
4. O número da comanda **não é segredo nem autorização**: consultar por número exige sessão e pertencer ao estabelecimento.

## 3. Proteção de dados pessoais (CPF e nome)

| Medida | Implementação |
|---|---|
| Minimização | `cpf_policy` (`none` = não coleta); só nome e CPF opcional |
| Criptografia em repouso | CPF em `consumers.cpf_enc`, AES-256-GCM (IV aleatório por registro), chave `DATA_KEY` |
| Busca sem expor o CPF | `cpf_hash` = HMAC-SHA256(`estabelecimento:cpf`) |
| Mascaramento | respostas e telas mostram `***.982.247-**`; o CPF completo só sai em `GET /consumers/:id?reveal=true` para gerente/admin e **gera `consumer.cpf_reveal` na auditoria** |
| Exportações | CSV não inclui CPF; exportar gera `report.export` |
| Auditoria sem excesso | `before/after` de consumidores guardam só a versão **mascarada**; senhas nunca são gravadas |
| Dados de cartão | **não são coletados nem guardados** (só a referência da transação) |

**Atenção — `DATA_KEY`:** trocar a chave torna os CPFs gravados ilegíveis (falha de decriptação). Para rotacionar: leia todos com a chave antiga, regrave com a nova em uma migração controlada. Faça backup seguro da chave **separado** do backup do banco. (A mesma chave é usada para criptografia e HMAC; em uma evolução, separe em duas chaves.)

### Pendências para conformidade com a LGPD (decisão do negócio/jurídico)

- Definir **finalidade e base legal** do tratamento de nome/CPF e se o CPF será exigido (o sistema suporta as três políticas).
- Definir **prazo de retenção** e implementar expurgo/anonimização de `consumers` (não há rotina automática; `tabs.consumer_id` é opcional e `consumers` pode ser anonimizado sem afetar valores financeiros).
- Procedimentos de **atendimento ao titular** (acesso, correção — `PATCH /consumers/:id` já audita —, eliminação/anonimização) e **resposta a incidentes**.
- Controle de acesso aos **backups**.

## 4. Segurança da aplicação

| Tema | Situação |
|---|---|
| Injeção SQL | Todas as consultas usam parâmetros (`$1…`); os fragmentos dinâmicos (`WHERE`) são montados só com texto fixo do código |
| Validação de entrada | `zod` em todos os corpos; UUIDs/enums validados; erros do PostgreSQL de tipo viram 400 |
| Cabeçalhos | `helmet` ativo |
| CORS | restrito a `CORS_ORIGIN` |
| CSRF | não aplicável ao esquema atual (token em cabeçalho `Authorization`, sem cookies) |
| XSS | React escapa o conteúdo; não há `dangerouslySetInnerHTML`. Risco residual: token em `localStorage` |
| Segredos | `.env` fora do repositório (`.gitignore`); `JWT_SECRET` ≥ 32 caracteres exigido em produção |
| Logs | JSON, com `requestId`; sem senhas/tokens; erros 500 com stack só no log do servidor |
| Dependências | rode `npm audit` periodicamente; **Next.js** e demais pacotes precisam de atualização de segurança regular |
| Rate limit geral | só no login; adicione limitação por IP/usuário no proxy para as demais rotas |

## 5. Integridade e prevenção de fraude

- Histórico imutável por trigger (itens, pagamentos, ajustes, estornos, auditoria): correções = registros compensatórios.
- Auditoria de operações críticas com quem, quando, onde (terminal), antes/depois, motivo e `request_id`.
- Descontos/cancelamentos/estornos/reaberturas/exceções exigem motivo e autoridade; aparecem em relatórios (descontos, cancelamentos, estornos, divergências, reaberturas).
- Para maior garantia, envie `audit_events` a um serviço externo de logs com retenção imutável (não implementado).

## 6. Checklist antes de produção

1. Novos `JWT_SECRET` e `DATA_KEY`; `NODE_ENV=production`.
2. Trocar/desativar as contas de exemplo; `NEXT_PUBLIC_DEMO_LOGINS=false`.
3. HTTPS em ambos os serviços; `CORS_ORIGIN` com o endereço real.
4. Banco gerenciado, backups automáticos e **restauração testada**.
5. `npm audit` e atualização do Next.js/NestJS.
6. Limitação de requisições no proxy; monitoramento do `/health`.
7. Teste de carga com o volume real; treinamento e contingência.
