# Registro de mudanças

Formato: mais recente primeiro. Para cada mudança relevante registre: data, o quê, por quê, arquivos/migrações afetados e quem aprovou. Mudanças de banco devem citar a migração.

## [1.0.0] — 2026-10-17

### Entregue
- API NestJS com módulos: auth, users, establishments (+ eventos e terminais), consumers, tabs, catalog, orders, adjustments, checkout, payments, cash-register, audit, reports.
- Banco PostgreSQL (`migrations/001_init.sql`): schema completo, índices únicos de regra, triggers de histórico imutável, função `tab_totals`.
- Interface Next.js: login, recepção, consumo, caixa, comandas, extrato imprimível, produtos, usuários, configurações, relatórios, auditoria.
- Testes e2e da API (82 verificações) e roteiro de interface com Playwright.
- Documentação técnica em `docs/` e README de execução.

### Validação registrada
- `npm run test:e2e`: 82 aprovados, 0 falhas (em cópia limpa do pacote, seguindo o README).
- Roteiro de interface: recepção → consumo → caixa (Pix) → encerramento → telas de gestão, sem erros de console relevantes.
- Ambiente de teste: Node 22, PostgreSQL 16 instalado diretamente. O `docker-compose.yml` não foi executado pelo autor; foi validado depois pelo usuário em Windows (ver nota de porta em `docs/09`).

### Decisões e limitações
Ver `docs/10-DECISOES-E-REGISTROS.md`.

### Observação de implantação (Windows)
Em máquinas com PostgreSQL já instalado, a porta 5432 pode estar ocupada; usar o mapeamento `"5433:5432"` no `docker-compose.yml` e `DATABASE_URL` com a porta 5433.
