# 01 — Arquitetura

## 1. Visão geral

Monólito modular: uma API NestJS, um banco PostgreSQL e uma interface Next.js. Não há filas, cache nem microsserviços (decisão do documento de requisitos: complexidade só quando houver necessidade comprovada).

```
 Navegador (Next.js, porta 3000)
   │  fetch + JWT (Authorization) + X-Terminal-Id + Idempotency-Key
   ▼
 API NestJS (porta 3001, prefixo /api/v1)
   │  requestMiddleware → helmet/CORS → AuthGuard → Controller → Service → Banco
   ▼
 PostgreSQL (driver pg, SQL explícito)
   • tabelas + índices únicos parciais
   • triggers de integridade (histórico imutável)
   • função tab_totals() = fonte única dos totais
```

**Princípio central:** toda garantia financeira vive no **backend e no banco**; o front apenas apresenta e coleta. O front nunca envia preço nem total.

## 2. Tecnologias

| Camada | Tecnologia | Observação |
|---|---|---|
| API | NestJS 10, TypeScript 5 | injeção de dependência, guard global, filtro global de exceções |
| Validação | `zod` | cada endpoint valida o corpo com um schema |
| Banco | PostgreSQL 14+ via `pg` | sem ORM; transações explícitas (`DatabaseService.tx`) |
| Autenticação | JWT (`jsonwebtoken`), senhas com `bcryptjs` | token de 10 h |
| Criptografia | `crypto` nativo (AES-256-GCM, HMAC-SHA256) | usada no CPF |
| Interface | Next.js 14 (App Router), React 18, CSS próprio | todas as páginas são Client Components |
| Testes | script Node (`backend/test/e2e.mjs`) | roda contra API + banco reais |

## 3. Ciclo de vida de uma requisição

1. `requestMiddleware` (`common/logging/request.middleware.ts`) cria/propaga o `x-request-id`, registra um log JSON por requisição (desligável com `LOG_REQUESTS=false`).
2. `helmet` e CORS (`main.ts`). Cabeçalhos permitidos: `Content-Type`, `Authorization`, `Idempotency-Key`, `X-Terminal-Id`, `X-Request-Id`.
3. **`AuthGuard`** (guard global, `common/authorization/auth.guard.ts`):
   - rotas `@Public()` passam direto (login e health);
   - valida o JWT; **consulta o usuário no banco a cada requisição** (usuário desativado perde acesso imediatamente);
   - valida o cabeçalho opcional `X-Terminal-Id` (terminal deve existir, estar ativo e ser do mesmo estabelecimento);
   - aplica `@Roles(...)` do endpoint (403 `SEM_PERMISSAO`).
4. **Controller** só roteia: extrai `@CurrentCtx()`, parâmetros e corpo, e chama o service.
5. **Service** valida com `zod`, abre transação, trava a comanda, aplica regras, grava auditoria e devolve a visão atualizada.
6. **`AllExceptionsFilter`** converte qualquer exceção (`AppError`, `ZodError`, `HttpException`, erros do PostgreSQL) no formato padrão de erro (ver [04-API](04-API.md)).

### Contexto da requisição (`Ctx`)

Definido em `common/authorization/context.ts`:

```ts
interface Ctx { user: { id, name, role, establishmentId }; terminalId: string | null; requestId: string }
```

Todo service recebe `ctx` como primeiro argumento. **Todo acesso a dados filtra por `ctx.user.establishmentId`** — é assim que se garante o isolamento entre estabelecimentos.

## 4. Padrão de transação, trava e auditoria

```ts
return this.db.tx(async (c) => {                 // BEGIN … COMMIT/ROLLBACK
  const tab = await this.tabs.lock(c, ctx, id);  // SELECT … FOR UPDATE na comanda
  /* checa estado, regras, idempotência */
  /* grava dados */
  await this.tabs.refreshStatus(c, id);          // recalcula estado financeiro
  await this.audit.log(c, ctx, { … });           // auditoria na MESMA transação
  return this.tabs.view(c, ctx, id);             // devolve estado atualizado
});
```

- A trava na linha da comanda **serializa** lançamentos, pagamentos, ajustes e fechamento da mesma comanda; comandas diferentes não bloqueiam umas às outras.
- Se qualquer passo falhar, nada é gravado (incluindo a auditoria).
- Ordem de travas: sempre **comanda primeiro**; só depois pagamento/item. (Evita deadlock; ver `PaymentsService.transition`.)

## 5. Dependências entre módulos

```
AppModule
 ├─ DatabaseModule (global)  → DatabaseService (pool + tx)
 ├─ AuditModule    (global)  → AuditService, GET /audit-events
 ├─ AuthModule     (global)  → AuthService, ApprovalService, /auth/*
 ├─ UsersModule, EstablishmentsModule (+eventos, terminais), CatalogModule
 ├─ ConsumersModule          → ConsumersService (usado por TabsService)
 ├─ TabsModule               → TabsService (exportado: lock/view/refreshStatus)
 │    └─ usado por: OrdersModule, AdjustmentsModule, CheckoutModule, PaymentsModule
 ├─ CashRegisterModule, ReportsModule
 └─ APP_GUARD = AuthGuard
```

`TabsService` é o núcleo compartilhado: trava, visão da comanda e recálculo de estado.

## 6. Mapa de arquivos

### Backend (`backend/`)

| Arquivo | Linhas | Responsabilidade |
|---|---|---|
| `migrations/001_init.sql` | 296 | Schema completo, índices, triggers e a função `tab_totals` |
| `src/main.ts` | 20 | Bootstrap: prefixo `/api/v1`, helmet, CORS, filtro global |
| `src/app.module.ts` | 26 | Módulo raiz; registra o `AuthGuard` global |
| `src/health.controller.ts` | 13 | `GET /health` (público; testa o banco) |
| `src/config/env.ts` | 20 | Lê e valida variáveis de ambiente (falha ao iniciar se faltar) |
| `src/common/database/database.service.ts` | 33 | Pool `pg`, `tx()`, parsers de `bigint`/`numeric` → número |
| `src/common/errors/app-error.ts` | 10 | `AppError` e atalhos (`notFound`, `conflict`, …) |
| `src/common/errors/all-exceptions.filter.ts` | 54 | Mapeia exceções → resposta de erro padrão |
| `src/common/authorization/auth.guard.ts` | 46 | Autenticação, terminal e perfis |
| `src/common/authorization/context.ts` | 14 | Tipos `Role`/`Ctx`, decorators `@Public`, `@Roles`, `@CurrentCtx`, `@ClientIp` |
| `src/common/crypto/crypto.ts` | 19 | AES-256-GCM e HMAC do CPF |
| `src/common/validation/{parse,cpf}.ts` | 8 / 16 | Helpers `zod`; validação e máscara de CPF |
| `src/common/logging/request.middleware.ts` | 11 | `requestId` e log de acesso |
| `src/database/{migrate,seed,reset}.ts` | 30/45/12 | Aplicar migrações, dados de exemplo, recriar schema (dev) |
| `src/modules/auth/auth.module.ts` | 98 | Login, perfil, troca de senha, **`ApprovalService`** |
| `src/modules/audit/audit.service.ts` | 55 | Gravação e consulta de auditoria |
| `src/modules/users/users.module.ts` | 64 | Usuários |
| `src/modules/establishments/establishments.module.ts` | 115 | Estabelecimento, eventos, terminais |
| `src/modules/consumers/consumers.module.ts` | 114 | Cadastro de consumidores (CPF criptografado) |
| `src/modules/tabs/tabs.service.ts` | 201 | **Núcleo:** abrir, listar, consultar, travar, estados |
| `src/modules/tabs/tabs.module.ts` | 22 | Controller de comandas |
| `src/modules/catalog/catalog.module.ts` | 106 | Produtos, preços, promoções, histórico |
| `src/modules/orders/orders.module.ts` | 99 | Lançamento de consumo (idempotente) |
| `src/modules/adjustments/adjustments.module.ts` | 94 | Cancelamento de item e descontos |
| `src/modules/checkout/checkout.module.ts` | 140 | Extrato, conferência, fechamento, reabertura |
| `src/modules/payments/payments.module.ts` | 136 | Pagamentos, conciliação, estorno |
| `src/modules/cash-register/cash-register.module.ts` | 77 | Caixa por turno |
| `src/modules/reports/reports.module.ts` | 116 | Relatórios e exportação CSV |
| `test/e2e.mjs` | 241 | Testes de ponta a ponta |

### Frontend (`frontend/`)

| Arquivo | Responsabilidade |
|---|---|
| `lib/api.ts` | Cliente HTTP, `ApiError`, formatação de dinheiro/data, rótulos |
| `lib/auth.tsx` | Contexto de sessão (usuário, estabelecimento, terminais, terminal ativo) |
| `components/Shell.tsx` | Barra superior, menu por perfil, guarda de acesso à página |
| `components/ui.tsx` | Toasts, `Modal`, `Badge`, `useApproval`, `usePrompt` |
| `app/layout.tsx`, `app/globals.css` | Estrutura raiz e estilos (inclui `@media print`) |
| `app/page.tsx` | Início |
| `app/login/`, `recepcao/`, `consumo/`, `caixa/`, `comandas/`, `extrato/[id]/` | Telas operacionais |
| `app/produtos/`, `usuarios/`, `config/`, `relatorios/`, `auditoria/` | Telas de gestão |

> O código dos módulos do backend usa o padrão `*.module.ts` contendo **Service + Controller + Module** do mesmo domínio em um único arquivo (exceto `tabs`, `audit`, que separam service). Ao crescer, divida em `*.service.ts`/`*.controller.ts`.
