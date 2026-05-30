# CONC-04 — UI Conciliação de Ativos

> **ID:** CONC-04 · **Depende de:** CONC-03  
> **Spec mestre:** [`docs/architecture/invest_conciliacao.md`](../../docs/architecture/invest_conciliacao.md) §7.2

## 1. Objetivo

Tela `/invest/conciliacao-ativos` — pasta de PDFs de notas, duas tabelas, PM e vínculo financeiro.

## 2. Arquivos

- `frontend/src/pages/InvestConciliacaoAtivosPage.js`
- `frontend/src/styles/invest-conciliacao.css` (estender)
- Rotas, menu, seeds UI (`screen.invest.conciliacao_ativos.*`)

Colunas: espelhar `InvestHistoricoOperacoesPage` (taxas, gross, qtd, nota) + PM estrito/B3/gerencial + status batimento + checkbox.

## 3. Critério de aceite

Manual: importar nota nova via → ; conferir carteira `/invest/portfolio` PM; rebuild disparado.

Remover ou redirecionar menu **Histórico de operações** → link para Conciliação de Ativos (decisão: redirect 302 client-side).

## 4. O que NÃO fazer

- Extrato nesta tela (link para conciliação bancária)
