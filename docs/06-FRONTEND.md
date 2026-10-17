# 06 — Frontend (Next.js)

Next.js 14 (App Router), React 18, TypeScript, CSS único (`app/globals.css`). **Todas as páginas são Client Components** (`'use client'`): não há dados renderizados no servidor; tudo vem da API via `fetch`.

## 1. Configuração

| Variável (`frontend/.env.local`) | Padrão | Uso |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api/v1` | endereço da API (embutido no build; reinicie o `npm run dev` após mudar) |
| `NEXT_PUBLIC_DEMO_LOGINS` | `true` | mostra atalhos de login com as contas de teste; **use `false` em produção** |

Scripts: `npm run dev` (porta 3000), `npm run build`, `npm start`.

## 2. Camada comum

### `lib/api.ts`
- `api(method, path, body?, {key?})`: adiciona `Authorization` (token do `localStorage`), `X-Terminal-Id` (terminal escolhido) e `Idempotency-Key` (se informado). Em erro lança **`ApiError(status, code, message)`**. Falha de rede → `ApiError(0, 'SEM_CONEXAO', …)`. Resposta 401 (exceto no login) limpa o token e redireciona para `/login`.
- `newKey()`: gera chave de idempotência (UUID).
- `download(path, nome)`: baixa arquivo autenticado (CSV).
- `money(centavos)` → `R$ 1.234,56`; `parseMoney("12,50")` → `1250` (`NaN` se inválido); `dt()`; dicionários `STATUS_LABEL`, `METHOD_LABEL`, `ROLE_LABEL`.

### `lib/auth.tsx` (`AuthProvider`, `useAuth`)
Carrega `/auth/me` e `/terminals`; guarda `me`, `terminals`, `terminalId` (persistido em `localStorage`); expõe `login`, `logout`, `refresh`, `setTerminal`. O token fica em `localStorage` (`token`).

### `components/Shell.tsx`
Envolve cada página: redireciona para `/login` sem sessão; mostra o menu conforme o perfil (`NAV`); seletor de terminal; prop `roles` exibe "sem acesso" se o perfil não pode ver a tela. **Isso é conveniência de interface**: a segurança real está no backend.

### `components/ui.tsx`
- `ToastProvider`/`useToast()`: avisos `ok(msg)` / `err(erro)`.
- `Modal`, `Badge` (cor por estado).
- **`useApproval()`** → `{run, dialog}`: `run(fn)` executa `fn()`; se a API responder `APROVACAO_NECESSARIA` ou `DESCONTO_ACIMA_DO_LIMITE`, abre o diálogo de credenciais e repete `fn(approval)`. Cancelar lança `Error('Autorização cancelada')`.
- **`usePrompt()`** → `{prompt(titulo, rotulo), dialog}`: pede um texto (mín. 3 caracteres), usado para motivos. Cancelar lança `Error('Cancelado')`.

## 3. Telas

| Rota | Perfis (tela) | O que faz | Endpoints |
|---|---|---|---|
| `/login` | público | login; atalhos de contas se `DEMO_LOGINS` | `POST /auth/login` |
| `/` | todos | contadores e atalhos por perfil | `GET /tabs` |
| `/recepcao` | OPER | abre comanda (número opcional conforme `number_mode`, nome, CPF conforme `cpf_policy`); lista comandas ativas | `POST /tabs`, `GET /tabs` |
| `/consumo` | atendente, caixa, SUP+ | busca comanda por número; grade de produtos por categoria/busca; carrinho; lança; extrato rápido; cancela item (com motivo e aprovação) | `GET /tabs/:n`, `/products`, `/tabs/:id/items`, `POST …/items`, `POST …/adjustments` |
| `/caixa` | CAIXA+ | caixa (abrir/fechar); extrato completo; conferência; pagamentos (pendente/confirmar/recusar/cancelar/estornar); descontos e reversão; encerrar (com fluxo de exceção); reabrir; bloquear/desbloquear; cancelar abertura; link para extrato impresso. Aceita `?n=00428` | quase todos os de comandas, pagamentos e caixa |
| `/comandas` | todos | listagem com filtros (situação, número/nome) e totais; atalhos para caixa/extrato | `GET /tabs` |
| `/extrato/[id]` | todos | extrato para **impressão** (`window.print`; menus ocultos por `@media print`) | `GET /tabs/:id/statement` |
| `/produtos` | GER | CRUD, preço/promoção/setores, histórico de preços | `/products` |
| `/usuarios` | GER | criar, alterar perfil, ativar/desativar, redefinir senha | `/users` |
| `/config` | GER | regras do estabelecimento, eventos, terminais | `/establishment`, `/events`, `/terminals` |
| `/relatorios` | GER, auditor, supervisor | indicadores, tabelas, divergências, caixa, CSV (GER) | `/reports/*` |
| `/auditoria` | GER, auditor | eventos com filtros e detalhes antes/depois | `/audit-events` |

## 4. Padrões importantes

1. **Idempotência no cliente.** `consumo` (lançar) e `caixa` (pagar) guardam a chave em `useRef` e a **mantêm** se a rede falhar (`ApiError.status === 0`), para que o reenvio não duplique; a chave é descartada após sucesso, erro de negócio ou mudança do carrinho.
2. **Nada de totais calculados no cliente que valham como verdade.** O carrinho mostra uma estimativa para o operador; o valor real vem de `tab.totals`.
3. **Autorização adicional** sempre via `useApproval().run(...)`.
4. **Motivos** (cancelar, reabrir, estornar, etc.) sempre via `usePrompt()` — o backend exige.
5. **Recarregar após agir.** Em `caixa`, `act()` executa a ação, recarrega o extrato e o caixa, e mostra toast de sucesso/erro.
6. **Tokens de estado:** badges usam as classes `b-<estado>`; novo estado exige CSS + rótulo.

## 5. Como adicionar uma tela

1. Crie `app/<rota>/page.tsx` com `'use client'` e envolva o conteúdo em `<Shell roles={[...]}>`.
2. Use `api()` e `useToast()`; trate erros com `toast.err(e)`.
3. Adicione o item em `NAV` (`components/Shell.tsx`) com os perfis.
4. Garanta que o endpoint tenha o mesmo `@Roles` no backend.
5. Documente a tela na tabela da seção 3.

## 6. Limitações conhecidas

- Token no `localStorage` (vulnerável a XSS; não há conteúdo HTML dinâmico não escapado no código, mas avalie cookies `HttpOnly` para produção).
- Sem testes automatizados de interface no repositório além do roteiro opcional `frontend/tests/ui_smoke.py`.
- Sem modo offline: ao perder a conexão a operação falha com aviso; **reenviar usa a mesma chave**.
- Interface otimizada para desktop/tablet; celular funciona, sem layout dedicado.
