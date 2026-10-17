# 09 — Operação e manutenção

## 1. Variáveis de ambiente

### Backend (`backend/.env`)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | `postgresql://usuario:senha@host:porta/banco` |
| `JWT_SECRET` | sim | segredo de assinatura (≥ 32 caracteres em produção) |
| `DATA_KEY` | sim | 64 caracteres hexadecimais (32 bytes) — criptografia/HMAC do CPF. **Não perca nem troque sem migrar.** |
| `PORT` | não (3001) | porta da API |
| `CORS_ORIGIN` | não (`http://localhost:3000`) | origens permitidas, separadas por vírgula |
| `NODE_ENV` | não | `production` ativa exigências de segurança e bloqueia `db:reset` |
| `LOG_REQUESTS` | não | `false` desliga o log de acesso |
| `API_URL` | só nos testes | URL base usada pelo `e2e.mjs` |

Gerar segredos: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Frontend (`frontend/.env.local`): ver [06 §1](06-FRONTEND.md#1-configuração).

## 2. Scripts

| Pasta | Comando | Função |
|---|---|---|
| backend | `npm run start:dev` | API com recarga automática (`ts-node-dev`) |
| backend | `npm run build` / `npm start` | compila para `dist/` / executa em produção |
| backend | `npm run db:migrate` | aplica migrações pendentes |
| backend | `npm run db:seed` | dados de exemplo (só em banco vazio) |
| backend | `npm run db:setup` | migrate + seed |
| backend | `npm run db:reset` | **apaga tudo** e recria (só desenvolvimento) |
| backend | `npm run test:e2e` | testes de ponta a ponta |
| frontend | `npm run dev` / `build` / `start` | interface |

## 3. Publicação (resumo)

1. Servidor Linux/nuvem com Node 20/22 e PostgreSQL gerenciado.
2. Backend: configurar `.env` de produção → `npm ci && npm run build && npm run db:migrate && npm start` (use um gerenciador de processos: systemd, PM2 ou contêiner).
3. Frontend: `NEXT_PUBLIC_API_URL` apontando para a API → `npm ci && npm run build && npm start` (ou hospedagem compatível com Next.js).
4. Proxy reverso com HTTPS (Nginx, Caddy, etc.) na frente dos dois.
5. **Não** rode `db:seed` em produção; crie o primeiro estabelecimento/admin de forma controlada (por exemplo, rode o seed uma vez, troque as senhas e desative as contas de exemplo).
6. Ambientes separados (desenvolvimento, homologação, produção), segredos fora do código.

> Dockerfiles/CI de produção **não** estão incluídos; só o `docker-compose.yml` do PostgreSQL para desenvolvimento.

## 4. Monitoramento

- `GET /api/v1/health` (público): responde `{status:"ok", database:"ok"}`; use em monitor externo e alerta.
- Logs JSON em stdout: `{level, requestId, method, url, status, ms, user}`; erros 500 com `stack`. Pesquise por `requestId` (também exibido ao usuário no erro).
- Sugestão de alertas: `/health` fora do ar, taxa de 5xx, latência (meta do documento: 95% < 500 ms), pagamentos pendentes antigos (relatório *Pagamentos por forma*), diferenças de caixa.

## 5. Backup e restauração

Backup lógico (substitua usuário/host/porta):

```bash
pg_dump -h localhost -p 5432 -U comandas -Fc comandas > comandas_AAAAMMDD.dump
```

Com Docker (Windows/PowerShell, evita corromper binário no redirecionamento):

```powershell
docker exec comandas-db sh -c "pg_dump -U comandas -Fc comandas > /tmp/b.dump"
docker cp comandas-db:/tmp/b.dump .\comandas_backup.dump
```

Restauração em banco novo (**teste isso periodicamente**):

```bash
createdb -U postgres comandas_restaurado
pg_restore -U postgres -d comandas_restaurado --no-owner --clean --if-exists comandas_backup.dump
```

Metas do documento (propostas, não garantias): RPO ≤ 5 min e RTO ≤ 1 h exigem backup contínuo/replicação do provedor do banco. Guarde a `DATA_KEY` em cofre **separado** do backup.

## 6. Receitas de manutenção

### 6.1 Alterar o banco
Crie `backend/migrations/00N_descricao.sql` (ex.: `002_add_campo.sql`) com `ALTER TABLE …`/`CREATE OR REPLACE FUNCTION …`. Rode `npm run db:migrate`. Nunca edite migrações já aplicadas em bancos com dados.

### 6.2 Nova regra de totais
Nova migração com `CREATE OR REPLACE FUNCTION tab_totals(...)`. Se mudar colunas de retorno, ajuste `VIEW_SQL`/`mapTab` (`tabs.service.ts`), relatórios e o front (`totals`). Rode o e2e.

### 6.3 Novo endpoint
1. `zod` schema + método no service seguindo o padrão de [01 §4](01-ARQUITETURA.md#4-padrão-de-transação-trava-e-auditoria) (transação → `lock` → regras → `refreshStatus` se financeiro → `audit.log`).
2. Rota no controller com `@Roles(...)`.
3. Se altera a comanda: **nunca** sem `lock`.
4. Teste no `e2e.mjs`; documente em [04](04-API.md) e [03](03-BACKEND-MODULOS.md); registre no `CHANGELOG.md`.

### 6.4 Nova forma de pagamento
(a) migração alterando o CHECK de `payments.method`; (b) enum `zod` em `payments.module.ts` (e a regra de "dinheiro" se aplicável); (c) `METHOD_LABEL` no front; (d) relatórios já agrupam por texto.

### 6.5 Novo perfil
(a) migração alterando o CHECK de `users.role`; (b) `Role` e `ALL_ROLES` em `common/authorization/context.ts`; (c) `@Roles(...)` dos endpoints; (d) `ROLE_LABEL`, `NAV` e `roles` das páginas no front; (e) enum `ROLES` em `users.module.ts`; (f) atualizar [05 §6](05-REGRAS-DE-NEGOCIO.md#6-autorizações).

### 6.6 Novo estado de comanda
(a) migração no CHECK de `tabs.status`; (b) `FINANCIAL_STATES`/`refreshStatus` e as listas `EDITABLE`/`PAYABLE` se afetar finanças; (c) trigger `items_only_open_tab` se mudar a regra de lançamento; (d) `STATUS_LABEL` e classe CSS `b-<estado>`; (e) atualizar o diagrama de [05](05-REGRAS-DE-NEGOCIO.md).

### 6.7 Nova configuração por estabelecimento
Coluna em `establishments` (migração) → `ESTABLISHMENT_COLUMNS` (`auth.module.ts`) → schema `settings` e `UPDATE` em `establishments.module.ts` → tela `config` → usar a configuração no service.

### 6.8 Novo relatório
Consulta em `ReportsService.summary` (ou método novo), sempre filtrando por `t.establishment_id = $1` e usando `LATERAL tab_totals` para valores; exiba em `relatorios/page.tsx`; se exporta dados pessoais, restrinja e audite.

### 6.9 Integrar provedor de pagamento (Pix/cartão)
O modelo já suporta: crie o pagamento como `pendente` com `reference` do provedor (chave de idempotência = identificador da cobrança) e confirme via endpoint `POST /payments/:id/confirm` chamado por um **webhook autenticado** do provedor (novo controller com verificação de assinatura). Nunca armazene dados completos de cartão. Faça a conciliação periódica comparando pendentes antigos.

### 6.10 Corrigir um lançamento errado
**Não apague.** Cancele o item (com motivo/autorização) e lance o correto; para pagamento errado, estorne (gerente) e registre outro.

## 7. Solução de problemas

| Sintoma | Causa provável | Ação |
|---|---|---|
| `role "comandas" não existe` ao rodar `db:setup` | outro PostgreSQL (instalado no Windows) responde em `localhost:5432` e não é o do Docker | Mudar o mapeamento do Docker para `"5433:5432"` e `DATABASE_URL` para a porta 5433; `netstat -ano \| findstr :5432` mostra dois processos |
| `Connection terminated unexpectedly` | mapeamento errado (ex.: `5433:5433` em vez de `5433:5432`) ou banco ainda iniciando | Conferir `docker compose ps` (`0.0.0.0:5433->5432/tcp`, `healthy`); trocar `localhost` por `127.0.0.1` |
| `Cannot GET /api/v1` | normal: não há rota na raiz | Use `/api/v1/health` |
| `Variável de ambiente … não definida` | faltou `.env` | `cp .env.example .env` |
| Login mostra "Sem conexão" | API parada ou `NEXT_PUBLIC_API_URL` errada | Subir a API; reiniciar `npm run dev` após editar `.env.local` |
| Erro de CORS | acesso por endereço diferente de `CORS_ORIGIN` | Ajustar `CORS_ORIGIN` |
| `COMANDA_OCUPADA` ao reabrir | número reaproveitado por outra comanda ativa | Encerrar a outra ou usar nova comanda |
| `CAIXA_FECHADO` ao receber | operador sem turno aberto | Abrir caixa em *Caixa* |
| `SALDO_PENDENTE` ao encerrar | saldo ≠ 0 ou pagamento pendente | Receber/confirmar, estornar excedente, ou exceção autorizada |
| `TENTE_NOVAMENTE` (503) | deadlock/serialização raro | Repetir (idempotência protege) |
| Erro 500 | falha inesperada | Procurar o `requestId` no log da API |
| CPFs ilegíveis (erro de decriptação) | `DATA_KEY` diferente da usada ao gravar | Restaurar a chave original |
