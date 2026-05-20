# [TÍTULO CURTO DA TASK]

> **Onda**: N · **ID**: NN · **Status**: ⬜ rascunho / ✅ pronta para execução
> **Autor**: arquiteto · **Executor sugerido**: Cursor (Sonnet 4.6) / Antigravity / outro

## 1. Objetivo (1 frase)

Descreva em uma frase o que esta task entrega. Se não couber em uma frase, a task está grande demais — quebre.

## 2. Contexto mínimo necessário

3-6 linhas explicando **por que** esta task existe e **onde se encaixa**. Não conte a história inteira do projeto — só o suficiente para o executor não inventar.

Links para docs/decisões relacionadas:
- [`/docs/architecture/AI_HANDOFF.md`](../docs/architecture/AI_HANDOFF.md) (sempre)
- [outros docs específicos da task]

## 3. Arquivos a tocar

Lista **explícita** dos arquivos que vão ser criados ou modificados, com path completo.

- `src/.../arquivo1.ts` (modificar — função X)
- `src/.../arquivo2.ts` (criar)
- `tests/unit/.../arquivo1.test.ts` (modificar — adicionar caso Y)

Se um arquivo precisa ser **apagado**, marque explicitamente.

## 4. Contrato

### Entrada / saída esperada

Para tarefas de código: assinatura de função, formato de payload, schema de retorno. Para UI: descrição precisa do estado antes/depois (ASCII mockup se ajudar).

```ts
// Exemplo:
export function calcularXYZ(input: AlgoEntrada): AlgoSaida {
  // contrato esperado pelo chamador
}
```

### Casos de borda obrigatórios

- Caso A: descrição → resultado esperado
- Caso B: descrição → resultado esperado
- ...

## 5. Critério de aceite

Comando(s) que precisam passar verdes. Esse é o contrato executável.

```bash
npx tsc --noEmit
npx jest tests/unit/path/to/test.test.ts
```

Se a verificação é manual (ex.: UI), descreva o passo-a-passo exato com expectativas observáveis (não "funcionar bem" — descreva o que aparece na tela).

## 6. Pegadinhas conhecidas

- Pegadinha 1: ...
- Pegadinha 2: ...

## 7. O que NÃO fazer nesta task

Lista negativa. Tarefas costumam atrair "limpezas tangenciais" — bloqueie-as aqui.

- Não tocar em [arquivo X / função Y] mesmo que pareça relacionado
- Não refatorar [Z] — é tema de outra task
- Não adicionar dependência sem nova spec

## 8. Saída esperada do executor

- Branch: `tipo/nome-curto`
- Commit(s): convenção `tipo(escopo): assunto curto` em português
- PR: título e corpo seguindo convenção, referência a este arquivo

## 9. Notas para quem revisa

Pontos específicos que o revisor (arquiteto) deve conferir antes do merge. Ex.: "Confirmar que a fórmula bate com o exemplo numérico do AI_HANDOFF §4.3."
