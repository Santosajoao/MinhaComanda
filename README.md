# Sistema de controle, consumo e conferência de comandas

Sistema completo (API + interface web + banco de dados) para boates, bares e restaurantes, conforme o documento de requisitos v1.0.
A regra central: **cada comanda tem o seu próprio número; nome e CPF são apenas dados cadastrais**.

| Parte | Tecnologia | Porta |
|---|---|---|
| `backend/` — API REST (`/api/v1`) | NestJS + TypeScript + PostgreSQL (driver `pg`, SQL explícito) | 3001 |
| `frontend/` — interface web | Next.js 14 + React + TypeScript | 3000 |
| Banco de dados | PostgreSQL 14 ou superior (testado na 16) | 5432 |

---

## 1. O que você precisa instalar

1. **Node.js 20 ou 22 (LTS)** — https://nodejs.org (o `npm` já vem junto).
   Confira no terminal: `node -v` (deve mostrar v20.x ou v22.x) e `npm -v`.
2. **Um PostgreSQL**, de **uma** das duas formas:
   - **Opção A (recomendada): Docker Desktop** — https://www.docker.com/products/docker-desktop — confira com `docker -v`.
   - **Opção B: PostgreSQL instalado direto** — https://www.postgresql.org/download/ (versão 14+; guarde a senha do usuário `postgres`).

Não é preciso instalar mais nada (as bibliotecas são baixadas pelo `npm install`).
Windows, macOS e Linux funcionam. No Windows use o **PowerShell** ou o **Prompt de Comando**.

## Documentação técnica completa

Toda a documentação do código está na pasta [`docs/`](docs/00-INDICE.md): arquitetura, banco de dados, módulos do backend, referência da API, regras de negócio, frontend, segurança/LGPD, testes, operação/manutenção e registro de decisões. O histórico de mudanças fica em [`CHANGELOG.md`](CHANGELOG.md).

## 2. Estrutura de pastas

```
comandas/
├── docs/                  # documentação técnica completa (comece por docs/00-INDICE.md)
├── CHANGELOG.md           # registro de mudanças
├── docker-compose.yml     # PostgreSQL pronto para uso (Opção A)
├── backend/               # API (NestJS)
│   ├── migrations/        # SQL do banco (tabelas, triggers de integridade, função de totais)
│   ├── src/modules/       # auth, users, establishments, consumers, tabs, catalog, orders,
│   │                      # adjustments, checkout, payments, cash-register, audit, reports
│   ├── src/database/      # migrate / seed / reset
│   └── test/e2e.mjs       # testes automatizados de ponta a ponta
└── frontend/              # Interface web (Next.js); tests/ui_smoke.py = roteiro opcional de interface
```

## 3. Passo a passo para rodar

Você vai usar **dois terminais** abertos ao mesmo tempo (um para a API, outro para a interface).
Abra o primeiro terminal **na pasta `comandas`** (a que contém este README).

### Passo 1 — Banco de dados

**Opção A — Docker** (na pasta `comandas`):

```bash
docker compose up -d
```

Aguarde ~10 segundos. Confira com `docker compose ps` (o estado deve ser `healthy`). Já cria o usuário, a senha e o banco `comandas`.

**Opção B — PostgreSQL instalado:** crie o usuário e o banco (ajuste o caminho do `psql` se necessário):

```bash
psql -U postgres -c "CREATE USER comandas WITH PASSWORD 'comandas';"
psql -U postgres -c "CREATE DATABASE comandas OWNER comandas;"
```

(Se usar outro usuário/senha/porta, ajuste a variável `DATABASE_URL` do Passo 2.)

### Passo 2 — API (terminal 1)

```bash
cd backend
```

Copie o arquivo de configuração:

- macOS / Linux: `cp .env.example .env`
- Windows (PowerShell ou CMD): `copy .env.example .env`

Instale as dependências, crie as tabelas e os dados de exemplo, e inicie a API:

```bash
npm install
npm run db:setup
npm run start:dev
```

Você deve ver: `API de comandas em http://localhost:3001/api/v1`.
Teste no navegador: http://localhost:3001/api/v1/health → `{"status":"ok","database":"ok",...}`.
**Deixe este terminal aberto.**

### Passo 3 — Interface (terminal 2)

Abra um **novo** terminal na pasta `comandas`:

```bash
cd frontend
```

- macOS / Linux: `cp .env.example .env.local`
- Windows: `copy .env.example .env.local`

```bash
npm install
npm run dev
```

Quando aparecer `Ready`, abra **http://localhost:3000**. **Deixe este terminal aberto.**

### Passo 4 — Entrar

Na tela de login há botões de atalho com as contas de teste. **Senha de todas: `Senha@123`**

| Perfil | E-mail | Faz o quê |
|---|---|---|
| Administrador | admin@exemplo.com | tudo, inclusive criar estabelecimentos |
| Gerente | gerente@exemplo.com | produtos, usuários, configurações, relatórios, estornos, exceções |
| Recepção | recepcao@exemplo.com | abre comandas |
| Atendente/garçom | atendente@exemplo.com | lança consumo |
| Caixa | caixa@exemplo.com | conferência, pagamentos, encerramento, caixa |
| Supervisor | supervisor@exemplo.com | descontos (até 10%), cancelamentos, reabertura, bloqueio |
| Auditor | auditor@exemplo.com | consulta relatórios e auditoria |

## 4. Roteiro de teste manual (≈10 minutos)

1. **Recepção** (`recepcao@`) → *Recepção*: informe nome "João da Silva" e CPF `529.982.247-25`, deixe o número vazio (automático) → **Confirmar abertura**. Anote o número (ex.: `00001`). Tente abrir de novo com o mesmo número: o sistema bloqueia.
2. **Consumo** (`atendente@`) → *Consumo*: digite o número, **Buscar**, toque em 3× Cerveja Long Neck, 2× Água, 1× Porção de Fritas → **Confirmar lançamento** (total R$ 95,00).
3. **Desconto com autorização** (`caixa@`) → *Caixa*: abra o caixa (troco R$ 100,00), busque a comanda, **Iniciar conferência**, aplique desconto de R$ 5,00 com motivo. Como o caixa não tem esse perfil, aparece o pedido de autorização: informe `supervisor@exemplo.com` / `Senha@123`. Total devido: R$ 90,00.
4. **Pagamento combinado**: registre Pix de R$ 50,00 (referência `E123456`); depois cartão de crédito de R$ 40,00 marcando *pendente* (referência `NSU999`). A comanda **não** fica paga: o cartão está pendente. Clique **confirmar** no pagamento pendente → comanda *Paga*.
5. **Encerrar** → *Encerrar comanda*; **Imprimir extrato** abre o extrato para impressão. Tente lançar item na comanda encerrada (tela Consumo): é bloqueado.
6. **Reabrir** (botão *Reabrir*, com autorização do supervisor) e **estornar** o Pix (autorização do gerente `gerente@exemplo.com`): o saldo volta a R$ 50,00.
7. **Exceção administrativa**: em outra comanda com saldo, tente *Encerrar* → o sistema recusa; aceite a exceção (gerente) e veja a divergência em *Relatórios*.
8. **Gerente** (`gerente@`): *Produtos* (altere um preço: comandas antigas mantêm o preço antigo), *Relatórios* (vendas, pagamentos, divergências, fechamentos de caixa, CSV), *Auditoria* (cada operação acima está registrada), *Configurações* (faixa de numeração, política de CPF, taxa de serviço, limite de desconto).
9. **Caixa** → *Fechar caixa*: informe o dinheiro contado; o sistema mostra esperado × contado.

## 5. Testes automatizados

Com a API rodando e o banco semeado (Passo 2), em um terceiro terminal:

```bash
cd backend
npm run test:e2e
```

São 82 verificações: autenticação, permissões, abertura/duplicidade, CPF, preços, idempotência, 25 lançamentos simultâneos, pagamentos simultâneos, descontos/cancelamentos com autorização, conferência, pagamento pendente, estorno, reabertura, exceções, caixa, relatórios, auditoria, isolamento entre estabelecimentos e proteções do banco (triggers). Resultado esperado: `82 aprovados, 0 falhas`.

> O teste cria comandas e mexe temporariamente no preço de um produto. Use no banco de desenvolvimento. Para voltar ao estado inicial: `npm run db:reset` (**apaga tudo** e recria com os dados de exemplo; pare a API antes).

## 6. Problemas comuns

| Sintoma | Solução |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | O PostgreSQL não está rodando. Docker: `docker compose up -d`. Instalado: inicie o serviço. |
| `password authentication failed` | Usuário/senha diferentes do `DATABASE_URL` em `backend/.env`. |
| `role "comandas" não existe`, `Connection terminated unexpectedly` ou `port 5432 is already in use` | Provavelmente já há um PostgreSQL instalado no Windows usando a porta 5432 (confira com `netstat -ano \| findstr :5432`). Mude o Docker para a porta 5433: no `docker-compose.yml` use exatamente `"5433:5432"` (a porta de dentro do contêiner continua 5432) e em `backend/.env` use `...@localhost:5433/comandas`. Depois `docker compose down`, `docker compose up -d` e `npm run db:setup`. O `docker compose ps` deve mostrar `0.0.0.0:5433->5432/tcp`. |
| `EADDRINUSE :3001` ou `:3000` | Porta ocupada. Mude `PORT` em `backend/.env` (e `NEXT_PUBLIC_API_URL` em `frontend/.env.local`, e `CORS_ORIGIN` se mudar a porta da interface). |
| Tela de login diz "Sem conexão com o servidor" | A API não está rodando ou `NEXT_PUBLIC_API_URL` está errado. Reinicie o `npm run dev` do frontend após editar `.env.local`. |
| `Variável de ambiente ... não definida` | Faltou copiar `.env.example` para `.env`. |
| Erro de CORS no navegador | Acesse a interface por `http://localhost:3000` (igual ao `CORS_ORIGIN`). |
| `relation ... does not exist` | Rode `npm run db:setup` na pasta `backend`. |

## 7. Regras de negócio implementadas

- **Comanda × CPF (RN-01/02/03):** UUID interno imutável + número visível (com zeros à esquerda). Índice único impede dois números ativos no mesmo estabelecimento. O CPF fica no cadastro do consumidor (criptografado com AES-256-GCM, buscado por HMAC), é validado (dígitos verificadores) e **mascarado** nas telas; só gerente/administrador consegue ver completo (cada visualização é auditada). A política é configurável: obrigatório, opcional ou não coletar.
- **Numeração:** automática (menor número livre na faixa) ou informada (cartões/pulseiras); faixa e dígitos configuráveis; reutilização após encerrar configurável (desligada = número indisponível durante todo o evento).
- **Estados (RF-03):** aberta → em conferência → aguardando pagamento → parcialmente paga → paga → encerrada, além de bloqueada e cancelada; transições controladas no servidor; reabertura só com autorização e justificativa.
- **Preço (RN-05):** o servidor define o preço no lançamento; alterar o produto depois não muda itens já lançados (e o banco impede alterar preço/quantidade de um item gravado). Promoções com vigência e disponibilidade por setor/PDV.
- **Totais (RN-06):** calculados no servidor por uma função SQL única (`tab_totals`) a partir de itens válidos, descontos, taxa e pagamentos *confirmados*. O front nunca envia total.
- **Idempotência (RN-07):** cabeçalho `Idempotency-Key` obrigatório em lançamentos e pagamentos; repetir a chamada devolve o resultado original.
- **Concorrência (RN-09):** cada operação bloqueia a linha da comanda (`SELECT … FOR UPDATE`) dentro de transação.
- **Ajustes (RN-08):** itens cancelados e descontos nunca são apagados (triggers proíbem `DELETE`); descontos podem ser revertidos mantendo o histórico; limite de desconto do supervisor configurável; acima dele, só gerente/administrador.
- **Autorização adicional (RF-09):** quem não tem o perfil pode concluir a operação se um supervisor/gerente informar as próprias credenciais (registrado como "aprovado por").
- **Pagamentos (RF-07):** dinheiro (com troco), Pix, débito, crédito e outros; pagamento combinado/parcial; pendente → confirmar/recusar/cancelar; estorno com gerente; referência da transação obrigatória fora do dinheiro; nunca guarda dados de cartão. Fechamento normal exige saldo zero e nada pendente (RN-12); exceção administrativa só com gerente e auditada.
- **Caixa:** turno por operador (troco inicial, recebimentos por forma, contagem, diferença).
- **Auditoria (RF-12):** tabela imutável (trigger) com usuário, terminal, requisição, antes/depois e motivo; senhas nunca são gravadas.
- **Segurança:** JWT, senhas com bcrypt, permissões validadas no servidor a cada requisição (usuário desativado perde acesso na hora), bloqueio de tentativas de login, isolamento por estabelecimento em todas as consultas, `helmet`, validação de entrada com `zod`.
- **Relatórios (RF-10):** vendas por dia/produto/categoria/PDV, ticket médio, pagamentos por forma, descontos/cancelamentos/estornos, divergências, exceções e reaberturas, fechamento de caixa; filtros por período e evento; exportação CSV (auditada).

## 8. Fora do escopo desta versão (é preciso saber)

O documento marca estes itens como "conforme a necessidade operacional"; **não** estão implementados:

- **Integração automática com Pix/maquininha/adquirente:** pagamentos são *registrados* pelo caixa com a referência da transação e podem ficar pendentes até a conferência manual. O desenho (status, idempotência, referência) já comporta ligar um provedor.
- **Modo offline** (fila local + sincronização), **pulseiras RFID/NFC**, **emissão fiscal**, integração com **estoque/PDV externo**, **impressora térmica** (a impressão usa o diálogo do navegador).
- **MFA** para administradores, **Redis**, **OpenAPI/Swagger** (os endpoints estão na seção 9), **Dockerfiles/CI** de produção.
- Variações/adicionais/combos são cadastrados como produtos separados; o estorno é sempre do valor total do pagamento.

## 9. Endpoints principais (`/api/v1`, exceto login exigem `Authorization: Bearer <token>`)

| Método | Rota | Finalidade |
|---|---|---|
| POST | `/auth/login` · GET `/auth/me` · PATCH `/auth/password` | Sessão |
| POST | `/tabs` · GET `/tabs` · GET `/tabs/:numero-ou-id` | Abrir, listar, consultar por número |
| POST | `/tabs/:id/items` (Idempotency-Key) · GET `/tabs/:id/items` | Lançar e consultar consumo |
| POST | `/tabs/:id/adjustments` · `/tabs/:id/adjustments/:adj/revoke` | Cancelamento e desconto |
| POST | `/tabs/:id/checkout` · `/confirm-statement` · `/resume` · GET `/tabs/:id/statement` | Conferência e extrato |
| POST | `/tabs/:id/payments` (Idempotency-Key) · GET `/tabs/:id/payments` | Pagamentos |
| POST | `/payments/:id/confirm` · `/reject` · `/cancel` · `/refunds` | Conciliação e estorno |
| POST | `/tabs/:id/close` · `/reopen` · `/block` · `/unblock` · `/cancel` | Ciclo de vida |
| POST/GET | `/cash-register/open` · `/current` · `/close` · `/sessions` | Caixa por turno |
| GET/POST/PATCH | `/products` · `/consumers` · `/users` · `/terminals` · `/events` · `/establishment` | Cadastros |
| GET | `/reports/summary` · `/reports/cash-closings` · `/reports/export?type=` · `/audit-events` | Relatórios e auditoria |

## 10. Colocando em produção (resumo)

1. Gere segredos novos: `JWT_SECRET` (32+ caracteres aleatórios) e `DATA_KEY` (64 hex: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). **Guarde a `DATA_KEY`**: sem ela os CPFs gravados não podem ser lidos.
2. `NODE_ENV=production`, PostgreSQL gerenciado com backup automático (e restauração testada), HTTPS na frente da API e da interface.
3. API: `npm run build && npm run db:migrate && npm start`. Interface: defina `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DEMO_LOGINS=false`, depois `npm run build && npm start`.
4. **Troque as senhas das contas de exemplo** (ou desative-as) e ajuste `CORS_ORIGIN` para o endereço real da interface.
5. Antes de operar: teste de carga com o volume real do estabelecimento, treinamento dos operadores e procedimento manual de contingência, conforme o checklist do documento (seção 14.1).
