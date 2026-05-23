# Protocolo obrigatorio — agentes executores

> **Novo desde V0.0.59.** Toda sessao de codigo neste repo segue a fila em `tasks/FILA.md`.

## Checklist na primeira sessao (faca nesta ordem)

1. `git pull origin main` (ou abrir o projeto ja atualizado)
2. Definir **sua** branch (uma vez por clone):

   ```bash
   git config coceo.machineBranch note-guto
   ```

   Valores: `note-guto` | `note-gamer` | `antigravity-gamer` | `antigravity-guto` — **cada agente um valor diferente**.

3. Alinhar versao e pegar tarefa (**sem o usuario pedir**):

   ```bash
   npm run git:ensure-sync
   npm run task:claim
   ```

4. Ler o bloco `## <ID>` em `tasks/FILA.md` e a **spec** indicada (se houver).
5. Implementar, testes verdes, banco/scripts se a task pedir.
6. Publicar codigo: `npm run git:ship -- -Message "tipo(escopo): assunto"`
7. Liberar a fila: `npm run task:done -- --id <ID>`

## O que NAO fazer

- **Nao** fazer polling em loop — `task:claim` **uma vez** no inicio da sessao (ou quando o usuario pedir nova tarefa).
- **Nao** codar sem ter rodado `task:claim` (tarefa tem que estar `claimed` no seu agente em `main`).
- **Nao** editar `status` / `agente` em `FILA.md` a mao.
- **Nao** pegar tarefa cujo `agente:` seja outro branch.
- Fila vazia → **pare** e avise o arquiteto; nao invente escopo.

## Se travar

```bash
npm run task:release -- --id <ID> --reason "motivo objetivo"
```

## Arquivos

| Arquivo | Quem edita |
|---------|------------|
| `tasks/FILA.md` | Arquiteto descreve tarefas; agentes so via `task:claim` / `task:done` |
| `tasks/QUEUE.md` | Gerado — somente leitura |
| `.cursor/rules/task-queue.mdc` | Regras automaticas no Cursor |

## Nova tarefa do arquiteto

Depois que ele publicar em `main`, agente **livre** (sem task ativa): rode de novo `git:ensure-sync` e `task:claim`. Agente ocupado termina a atual antes de pegar outra.
