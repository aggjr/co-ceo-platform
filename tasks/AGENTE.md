# Instrucao para agentes executores

**Primeira acao da sessao** (sem o usuario pedir):

```bash
npm run git:ensure-sync
npm run task:claim
```

O script le **`tasks/FILA.md`**, reserva a proxima tarefa `pending` e publica em `main`.

Depois abra o bloco `## <ID>` em **FILA.md** e a **spec** indicada (se houver).

Ao terminar: `npm run git:ship -- -Message "..."` → `npm run task:done -- --id <ID>`.

**Nao** altere `status` / `agente` na FILA a mao — use os comandos `task:*`.

Quadro resumo: `tasks/QUEUE.md` (somente leitura).
