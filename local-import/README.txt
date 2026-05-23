Dados locais de importação BTG (NÃO vão para o Git)
====================================================

Coloque aqui extratos e notas baixadas do Home Broker. O conteúdo de
`btg-sources/` está no .gitignore.

Estrutura
---------

  local-import/btg-sources/
    extrato/
      extrato.pdf          ← extrato conta corrente (único arquivo consolidado)
    notas-corretagem/
      004176105_AAAAMMDD_AAAAMMDD/   ← pastas ZIP descompactadas do BTG
        CASH/   *_SPOT_ALL.pdf
        OPTIONS/   *_OPTIONS_ALL.pdf
        LOAN/   *_ALUGUEL_ALL.pdf

Como atualizar (Home Broker)
----------------------------

1. Extrato conta corrente
   - Baixe o PDF do período desejado.
   - Substitua ou renomeie para: btg-sources/extrato/extrato.pdf
   - (Opcional) mantenha cópias por mês: extrato-2026-05.pdf

2. Notas de corretagem
   - Baixe os ZIPs mensais (SPOT + OPTIONS + ALUGUEL).
   - Descompacte cada ZIP dentro de btg-sources/notas-corretagem/
   - Mantenha as subpastas CASH, OPTIONS e LOAN como vêm do BTG.

Auditoria de taxas
------------------

  npx ts-node scripts/audit-btg-fees-full.ts

Gera relatório em btg-sources/auditoria/ (taxas nas notas + despesas no caixa/LFT).

Reconciliação de duplicatas (livro razão)
-----------------------------------------

  npx ts-node scripts/reconcile-duplicate-operations.ts

Detecta mesma operação importada por caminhos diferentes (número da nota ou
data+ticker+qty+preço) e risco de caixa em dobro.

Import de notas (idempotente — não duplica caixa)
-------------------------------------------------

  npx ts-node scripts/build-btg-brokerage-notes-review.ts local-import/btg-sources/notas-corretagem
  npx ts-node scripts/import-btg-brokerage-notes-ledger.ts local-import/btg-sources/auditoria/notas-review.json

Importação para o livro (após conferência)
------------------------------------------

  npx ts-node scripts/convert-btg-extract-pdf.ts local-import/btg-sources/extrato/extrato.pdf
  npx ts-node scripts/build-btg-brokerage-notes-review.ts local-import/btg-sources/notas-corretagem
