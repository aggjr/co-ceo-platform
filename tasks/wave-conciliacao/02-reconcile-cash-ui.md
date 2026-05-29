# CONC-02 — UI Conciliação Bancária

> **ID:** CONC-02 · **Depende de:** CONC-01  
> **Spec mestre:** [`docs/architecture/invest_conciliacao.md`](../../docs/architecture/invest_conciliacao.md) §7.1

## 1. Objetivo

Tela `/invest/conciliacao-bancaria` com seleção de pasta/arquivos, duas tabelas (livro | extrato), setas →/←, checkboxes e ações em lote.

## 2. Arquivos

- `frontend/src/pages/InvestConciliacaoBancariaPage.js` (criar)
- `frontend/src/styles/invest-conciliacao.css` (criar)
- `frontend/src/lib/importFilePicker.js` (recriar — copiar padrão mínimo da versão removida ou novo helper)
- `frontend/src/legacy/legacyRoutes.ts`
- `frontend/src/navigation/menuCatalog.js`
- `src/database/seeds/008_ui_catalog.ts` (menu + textos `screen.invest.conciliacao_bancaria.*`)

## 3. Layout

Validado com arquiteto — ver wireframe `canvases/conciliacao-bancaria-wireframe.canvas.tsx` e §7.1 do doc mestre.

Colunas tabela livro: igual antiga Extratos (`dateBr`, movimento, saldo, ticker, histórico, observação) + checkbox + batimento.

## 4. Critério de aceite

Manual:

1. Personificar holding → menu "Conciliação Bancária"
2. Escolher pasta com PDF extrato → Analisar → tabelas preenchidas
3. Selecionar linha só no extrato → → inserir → linha aparece à esquerda
4. Reload `/invest` — gráfico atualiza após rebuild (toast com dias gravados)

```bash
npx tsc --noEmit
```

## 5. O que NÃO fazer

- Textos hardcoded em português no JS (usar `getPageTexts` + seed)
- Notas de corretagem nesta tela
