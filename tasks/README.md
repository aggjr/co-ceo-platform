# tasks/ — handoff de trabalho para agentes executores

Este diretório guarda **task specs**: contratos formais de uma alteração específica que outro agente (Cursor, Antigravity, Copilot, etc.) deve executar.

## Por que existe

O arquiteto (Augusto) e o agente estratégico (Claude / Opus) tomam decisões de modelagem. Tarefas braçais bem-especificadas (implementar feature já desenhada, escrever teste de cenário descrito, mover arquivos, ajustar UI, configurar tooling) são executadas por agentes mais baratos a partir destas specs.

Spec ruim = código ruim. A qualidade da execução é proporcional à precisão da spec. Por isso o template em [`_template.md`](_template.md) força o autor da spec a ser explícito sobre escopo, contrato e critério de aceite.

## Estrutura

```
tasks/
├── README.md           — este arquivo
├── _template.md        — template para criar nova task spec
├── wave-2/             — ondas de trabalho do INVEST (engine 3 preços)
│   ├── 01-...md
│   └── 02-...md
├── wave-3/             — barramento canônico
└── ...
```

Cada onda é um conjunto de tarefas relacionadas. Numere as tasks em ordem de execução dentro da onda (`01-`, `02-`, …) quando houver dependência; use prefixo livre quando forem independentes.

## Fluxo do agente executor

1. Leia [`/.cursor/rules/co-ceo.mdc`](../.cursor/rules/co-ceo.mdc) (Cursor injeta automaticamente) ou [`/docs/architecture/AI_HANDOFF.md`](../docs/architecture/AI_HANDOFF.md). Doutrina não-negociável.
2. Abra a task spec inteira. Não execute parcialmente.
3. Confirme que entendeu o **critério de aceite** — esse é o contrato.
4. Crie branch `feat/...`, `refactor/...`, `fix/...` antes de tocar código.
5. Faça as alterações **estritamente** no escopo. Não refatore além do pedido.
6. Rode `npx tsc --noEmit` e o critério de aceite até verde.
7. Commit em português seguindo a convenção. PR referencia o caminho da task.
8. Se travar, **não invente** — descreva no PR/comentário o que tentou e o erro exato.

## Fluxo de quem escreve a task

1. Copie [`_template.md`](_template.md) para `wave-N/NN-titulo-curto.md`.
2. Preencha cada seção. Seja explícito sobre arquivos, linhas e contrato — vagueza vira código errado.
3. Liste **pegadinhas conhecidas** e o **que NÃO fazer** — quase tão importante quanto o que fazer.
4. Garanta que o critério de aceite é executável por terminal (comando de teste, build, etc.).
5. Marque a task como "✅ pronta para execução" quando estiver completa. Antes disso, deixe em rascunho.

## Estado das ondas

- ✅ **Onda 1** (concluída no commit `bf36857`): limpeza cirúrgica do INVEST — sem lotes, sem hardcode, sem patches por data.
- ⏳ **Onda 2** (em planejamento — feita junto com o arquiteto): engine dos 3 preços + view materializada do livro razão.
- 📋 **Onda 3**: barramento canônico do INVEST.
- 📋 **Onda 4**: terminar migração frontend Solid + theming por cliente.
- 📋 **Onda 5**: testes de integração e homologação.
- 📋 **Onda 6**: core de plataforma (IVA, GQM, Zachman, CMMI, TOC como motor).
