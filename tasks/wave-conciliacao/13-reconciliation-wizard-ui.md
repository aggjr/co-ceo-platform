# CONC-13 — UI wizard conciliação (notas, dia a dia)

> **Spec mestre:** [`docs/architecture/invest_reconciliacao_sessao.md`](../../docs/architecture/invest_reconciliacao_sessao.md) §F, **§J**  
> **Depende:** CONC-12

## Objetivo

Uma página `/invest/conciliacao`: pasta PDF notas → sessão → navegar dias.

**Obrigatório — painel “Pendências do dia”** (`pendingDecisions` da API):

- Lista cada divergência (preview + audit) com contexto (valores, delta, refs).
- Botões só com `allowedActions` (inserir, void, parear, manter A/B, confirmar skipped).
- Destaque cruzado nas tabelas livro|notas ao clicar na pendência.
- `Fechar dia` desabilitado até `canClose === true`; exibir `blockReasons[]` do catálogo UI.

**Proibido:** “aceitar aviso”, ignorar em lote, mutação sem passar por `resolve`/`apply` explícito.

UI simples; regras e `canClose` só no backend CONC-12.

## Arquivos

- `frontend/src/pages/InvestConciliacaoPage.js`
- `frontend/src/styles/invest-conciliacao.css`
- `frontend/src/lib/importFilePicker.js` (recriar)
- `frontend/src/legacy/legacyRoutes.ts`

## Critério de aceite

Manual: dia com divergência → painel lista pendência → usuário escolhe ação → botão fechar habilita → após fechar dia 2, gráfico reflete até dia 2 (CONC-00).
