# Instrucao para agentes executores

Ao iniciar qualquer sessao neste repositorio, **voce** executa (nao espere o usuario pedir):

```bash
npm run git:ensure-sync
npm run task:claim
```

O script le `tasks/queue.json`, reserva a proxima tarefa `pending` no seu agente (`coceo.machineBranch`) e publica em `main` para os outros nao pegarem a mesma.

Depois abra o arquivo **spec** que o comando imprimir (ex.: `tasks/wave-2/01-....md`).

Ao terminar: `npm run git:ship -- -Message "..."` → `npm run task:done -- --id <ID>`.

Quadro para humanos: `tasks/QUEUE.md` (somente leitura).
