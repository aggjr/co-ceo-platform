# Plano para Subir a Tela de Carteira

**Criado em:** 22/05/2026  
**Objetivo:** Ter pelo menos 1 tela funcional de carteira (posições atuais ou operações com opções) exibindo dados reais do banco.

---

## Situação Atual

### O que já existe e funciona

| Componente | Estado |
|---|---|
| Banco de dados (MySQL remoto) | ✅ Rodando em 69.62.99.34 |
| Backend Express (Node/TS) | ✅ Estrutura completa |
| Rota `GET /invest/portfolio` | ✅ Existe em `src/routes/api.ts` |
| Controller `InvestController.listPortfolio` | ✅ Existe em `src/controllers/InvestController.ts` |
| Frontend SolidJS + Vite | ✅ Estrutura completa |
| Página `InvestPortfolio.tsx` (SolidJS novo) | ✅ Criada, chama `apiRequest` |
| Página `InvestPortfolioPage.js` (legacy JS) | ✅ Existe (versão mais antiga) |
| Migrations 1–19 | ✅ Criadas |
| Migrations 1–18 aplicadas no remoto | ✅ |
| Migration 19 aplicada no remoto | ✅ (remove short_open/short_close) |
| Arquitetura de business events | ✅ Implementada |
| Valuations (ThreePricesValuation, WeightedAvg) | ✅ Refatoradas (4 branches universais) |
| Parser notas BTG | ✅ Fix aplicado (opções, maturity+ticker) |
| Parser extrato BTG | ✅ Normalização LFT implementada (qty×VNA) |
| Opening balance 2026-01-01 | ✅ Importado (5 ativos + 1 caixa) |

---

## O que Falta — Caminho Crítico para a Tela

### BLOCO 1 — Dados no Banco (1–2h, execução de scripts)

Estes passos devem ser executados **em ordem**. A tela não terá dados sem eles.

| # | Tarefa | Comando | Estimativa |
|---|---|---|---|
| 1.1 | Importar notas BTG (210 trades) | `npx ts-node scripts/import-btg-brokerage-notes-ledger.ts` | ~7 min |
| 1.2 | Importar extrato BTG (69 lançamentos) | `npx ts-node scripts/import-btg-extract-ledger.ts` | ~3 min |
| 1.3 | Validar zero pernas órfãs | `node scripts/inspect-ledger-events.js` | 1 min |
| 1.4 | Validar PMs e posições | `node scripts/inspect-invest-state.js` | 1 min |

**Critério de aceite do Bloco 1:**
- 251 patrimony legs + 281 financial legs, todas linkadas a business_event_id
- LFT com qty ≈ 0.36 títulos (soma das compras - vendas)
- Opções short com acq negativo e PM = prêmio recebido
- Ações (PRIO3, BBAS3, ITUB4, WEGE3) com PM gerencial > PM estrito

---

### BLOCO 2 — Backend Lendo dos Dados Novos (2–4h)

O `InvestController.listPortfolio` foi escrito para um modelo de dados **anterior** à refatoração de business events. Precisa ser auditado e, se necessário, adaptado para ler de `patrimony_items` (tabela nova canônica) em vez de tabelas legacy.

| # | Tarefa | Arquivo | Estimativa |
|---|---|---|---|
| 2.1 | Verificar de onde `listPortfolio` lê os dados | `src/controllers/InvestController.ts` L71+ | 30 min análise |
| 2.2 | Se lê legacy: adaptar para ler `patrimony_items` + `patrimony_ledger_entries` | `InvestController.ts` + `portfolioMapper.ts` | 2–3h |
| 2.3 | Se lê `patrimony_items`: verificar campos (PM triplo, acq, qty) | Teste manual via `curl /api/invest/portfolio` | 30 min |
| 2.4 | Verificar se `portfolioThreePrices.ts` lê dados do livro-razão novo | `src/core/invest/portfolioThreePrices.ts` | 30 min |

**Critério de aceite do Bloco 2:**
```bash
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/invest/portfolio
# Deve retornar posições com pmA, pmB, pmC e quantity corretos
```

---

### BLOCO 3 — Frontend Conectado (1–2h)

A página `InvestPortfolio.tsx` (SolidJS) já chama a API. Precisa verificar se está usando os campos corretos do response.

| # | Tarefa | Arquivo | Estimativa |
|---|---|---|---|
| 3.1 | Verificar URL que o frontend chama | `frontend/src/pages/InvestPortfolio.tsx` | 15 min |
| 3.2 | Verificar tipos esperados vs response da API | `InvestPortfolio.tsx` types ThreePrices, PortfolioItem | 30 min |
| 3.3 | Verificar rota no `frontend/src/router.js` (está registrada?) | `frontend/src/router.js` | 15 min |
| 3.4 | Build e teste visual no browser | `npm run dev` na pasta `frontend/` | 30 min |

**Critério de aceite do Bloco 3:**
- Página abre no browser sem erro 500
- Exibe pelo menos: PRIO3, BBAS3, ITUB4, WEGE3 com quantidades e PMs
- Opções short aparecem com quantidade negativa

---

### BLOCO 4 — Tela de Opções (opcional para primeira entrega) (2–3h)

Página dedicada às posições de opções vendidas (puts/calls) com:
- Strike, vencimento, premium recebido
- PM por posição
- Exposição total

| # | Tarefa | Estimativa |
|---|---|---|
| 4.1 | Verificar `InvestPortfolioPage.js` (seção de opções) se funciona com dados novos | 1h |
| 4.2 | Adaptar ou reescrever em SolidJS se necessário | 2h |

---

## Dependências Paralelas (não bloqueiam a tela mas devem ser feitas)

| Tarefa | Prioridade | Estimativa |
|---|---|---|
| Função matching extrato↔notas (IRRF opção, multas) | MÉDIA | 3h |
| Testes unitários cost_adjustment + parser + matching | MÉDIA | 2h |
| Commit final com todos os fixes de hoje | ALTA | 15 min |

---

## Estimativa Total

| Bloco | Tempo Estimado | Quem executa |
|---|---|---|
| Bloco 1 — Dados | 30 min execução | Script automático |
| Bloco 2 — Backend | 2–4h | Dev (Sonnet) |
| Bloco 3 — Frontend | 1–2h | Dev (Sonnet) |
| **Total mínimo para 1 tela** | **4–7h** | |

---

## Próximo Passo Imediato

1. Terminar o import das notas BTG que foi interrompido (Bloco 1.1)
2. Importar extrato (Bloco 1.2)
3. Validar dados (Bloco 1.3 e 1.4)
4. Auditar `InvestController.listPortfolio` para saber se lê das tabelas novas ou legacy

Essa auditoria (passo 4) é o ponto de decisão principal — dela depende quanto trabalho falta no Bloco 2.

---

## Arquivos-Chave de Referência

| Arquivo | Papel |
|---|---|
| `src/controllers/InvestController.ts` | API de portfólio (backend) |
| `src/routes/api.ts` | Rotas HTTP |
| `frontend/src/pages/InvestPortfolio.tsx` | Tela carteira (SolidJS) |
| `frontend/src/pages/InvestPortfolioPage.js` | Tela carteira (legacy JS) |
| `src/core/invest/portfolioMapper.ts` | Montagem da resposta da API |
| `src/core/invest/portfolioThreePrices.ts` | Cálculo PM triplo para API |
| `src/core/inventory/InventoryLedger.ts` | Ledger patrimonial canônico |
| `src/modules/invest/ThreePricesValuation.ts` | Valuation 3 preços |
| `scripts/inspect-invest-state.js` | Diagnóstico do banco |
| `scripts/inspect-ledger-events.js` | Verificação de órfãos |
