# Documentação técnica — Sistema de comandas

Documentação completa do código para **entendimento, manutenção e registro histórico**.
Escrita a partir do código real (versão 1.0.0). Quando o código mudar, atualize o documento correspondente e registre a mudança em [`../CHANGELOG.md`](../CHANGELOG.md).

| # | Documento | Para que serve | Leia quando… |
|---|---|---|---|
| 01 | [Arquitetura](01-ARQUITETURA.md) | Visão geral, camadas, ciclo de vida de uma requisição, mapa de arquivos | está chegando no projeto |
| 02 | [Banco de dados](02-BANCO-DE-DADOS.md) | Tabelas, índices, triggers, função `tab_totals`, migrações | vai mexer em dados ou criar migração |
| 03 | [Backend (módulo a módulo)](03-BACKEND-MODULOS.md) | Responsabilidade, fluxo, travas, auditoria e erros de cada módulo | vai alterar uma regra ou endpoint |
| 04 | [Referência da API](04-API.md) | Todas as rotas, permissões, corpos, respostas e códigos de erro | vai integrar ou testar a API |
| 05 | [Regras de negócio](05-REGRAS-DE-NEGOCIO.md) | Estados da comanda, cálculo financeiro, autorizações, mapa RN/RF → código | tem dúvida do "por quê" de um comportamento |
| 06 | [Frontend](06-FRONTEND.md) | Telas, componentes, comunicação com a API, padrões | vai alterar a interface |
| 07 | [Segurança e LGPD](07-SEGURANCA-E-LGPD.md) | Autenticação, autorização, criptografia do CPF, auditoria, riscos | vai revisar segurança ou privacidade |
| 08 | [Testes](08-TESTES.md) | O que os 82 testes cobrem e como estender | vai mudar algo e precisa validar |
| 09 | [Operação e manutenção](09-OPERACAO-E-MANUTENCAO.md) | Variáveis, scripts, backup, receitas de mudança, solução de problemas | vai publicar, dar suporte ou evoluir o sistema |
| 10 | [Decisões e registros](10-DECISOES-E-REGISTROS.md) | Decisões de projeto (ADR), limitações conhecidas, glossário | quer saber por que algo foi feito de um jeito |

## Convenções usadas em todo o código

- **Idioma:** textos de usuário, mensagens de erro, códigos de erro e nomes de estados em português; identificadores de código (classes, funções, colunas) em inglês.
- **Dinheiro:** sempre **inteiro em centavos** (`*_cents`) na API, no banco e no front. Só é formatado em reais na tela (`money()` em `frontend/lib/api.ts`).
- **Datas:** `timestamptz` no banco, ISO 8601 na API; relatórios agrupam por dia no fuso `America/Sao_Paulo`.
- **Identificadores:** UUID interno (imutável) em todas as tabelas; o **número da comanda** é um texto (`'00428'`) usado só pelos operadores.
- **Erros:** sempre `{ "error": { "code", "message", "details?", "requestId" } }`.
- **Operações críticas:** sempre dentro de transação, com a comanda travada (`SELECT … FOR UPDATE`) e com evento de auditoria gravado na mesma transação.
