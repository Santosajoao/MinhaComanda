# 08 — Testes

## 1. Testes de ponta a ponta da API — `backend/test/e2e.mjs`

Script Node (sem framework) que usa `fetch` contra a **API em execução** e o banco real; também abre uma conexão `pg` direta para provar as proteções do banco. Termina com código 0 se tudo passou.

```bash
# API rodando e banco semeado (npm run db:setup)
cd backend
npm run test:e2e          # esperado: "Resultado: 82 aprovados, 0 falhas"
# outra URL:  API_URL=http://host:3001/api/v1 npm run test:e2e
```

> O teste **cria dados** (comandas 428, 429, 431, 433, 434…, um estabelecimento extra) e altera/restaura o preço de "Cerveja Long Neck". Rode só em banco de desenvolvimento. Para limpar: pare a API e `npm run db:reset`. O script pode ser repetido sobre o mesmo banco (os números são reutilizáveis).

### O que cada seção verifica

| # | Seção | Cobertura |
|---|---|---|
| 1 | Autenticação e permissões | login dos 7 perfis; 401 com senha errada/sem token; 403 para atendente abrir comanda, caixa criar produto, auditor lançar |
| 2 | Abertura | `428` → `00428`; CPF mascarado; comanda ocupada bloqueada; CPF inválido; numeração automática + consumidor recorrente; número fora da faixa; busca por número sem zeros; CPF completo só para gerente |
| 3 | Consumo e preços | 3×cerveja+2×água+1×porção = R$ 95,00; **idempotência**; chave obrigatória; quantidade inválida; troca de preço não altera itens antigos; histórico de preços |
| 4 | Concorrência | 25 lançamentos paralelos sem perda; 8 envios paralelos com a mesma chave criam 1 item |
| 5 | Ajustes e autorização | atendente sem aprovação (403); aprovação por perfil indevido (403); cancelamento aprovado preservando histórico; limite de desconto do supervisor; desconto de R$ 5,00 → R$ 90,00; desconto maior que o consumo |
| 6 | Conferência e pagamentos | sem pagamento antes da conferência; permissões; extrato calculado no servidor; comanda em conferência não aceita itens; exige caixa aberto; excesso de valor; referência obrigatória; Pix parcial; repetição idempotente; cartão pendente não conta; fechamento bloqueado; confirmação quita; encerra; encerrada não aceita itens |
| 7 | Reabertura, dinheiro, estorno | reabertura exige autorização; número volta a ficar ocupado; troco; estorno exige gerente; saldo volta; novo pagamento; reencerra |
| 8 | Pagamentos simultâneos | 6 envios paralelos da mesma chave = 1 pagamento; 2 pagamentos incompatíveis simultâneos = 1 aceito |
| 9 | Exceção administrativa | só com gerente; encerra com saldo e registra |
| 10 | Caixa, relatórios, auditoria | fechamento de caixa (esperado × contado); resumo e divergências; permissões de relatório; CSV; tipos de evento na auditoria; auditoria sem senhas |
| 11 | Isolamento | outro estabelecimento não vê comanda (por número, id, extrato); catálogo vazio; só admin cria estabelecimento |
| 12 | Banco | triggers bloqueiam UPDATE/DELETE de auditoria, alteração de preço de item, DELETE de item/pagamento, alteração de valor de pagamento, item em comanda encerrada |

## 2. Roteiro de interface (opcional) — `frontend/tests/ui_smoke.py`

Script Playwright (Python) que dirige o navegador: recepção abre comanda → atendente lança → caixa abre caixa, confere, paga por Pix e encerra → gerente abre relatórios, auditoria, produtos, usuários, configurações e comandas.

```bash
pip install playwright && playwright install chromium
# API e frontend rodando, banco semeado, NEXT_PUBLIC_DEMO_LOGINS=true
python frontend/tests/ui_smoke.py
```

Resultado esperado: `fluxo de caixa ok: paga e encerrada`, `telas de gestão ok`. Mensagens de console `Failed to fetch RSC payload` são pré-carregamentos de rota cancelados pelas trocas rápidas de página do script (não são erros do sistema).

## 3. Como estender

- Novo cenário de API: acrescente em `e2e.mjs` usando `api(método, rota, {token, body, key, terminal})` e `check(nome, condição, detalhe)`. Use `uniq()` para chaves de idempotência.
- Toda correção de bug de regra deve vir com um `check` que falharia antes da correção.
- Mudou `tab_totals` ou um estado? Rode o e2e inteiro.

## 4. Lacunas conhecidas

- Não há testes unitários (as regras são testadas via API real).
- Não há teste de **carga** (apenas concorrência de 25 requisições). O documento exige validar com o volume real (150 × 3.000 clientes, dezenas de PDVs) antes de produção.
- Não há teste de restauração de backup automatizado (faça manualmente — ver [09](09-OPERACAO-E-MANUTENCAO.md)).
- Não há integração contínua (CI) configurada.
