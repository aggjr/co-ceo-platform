# Fila de trabalho — agentes

> Gerado em **2026-05-23T00:00:00.000Z** a partir de `tasks/queue.json`. **Nao edite esta tabela a mao.**

| ID | P | Titulo | Spec | Status | Agente | Assumida | Concluida | Release |
|----|---|--------|------|--------|--------|----------|-----------|---------|
| — | — | *(fila vazia)* | — | — | — | — | — | — |

## Arquiteto — adicionar tarefa

```bash
npm run task:add -- --id W3-01 --title "Barramento canonico INVEST" --spec tasks/wave-3/01.md --priority 80
```

Ou edite `tasks/queue.json` (novo item com `"status": "pending"`) e rode `npm run task:sync`.

## Agente — ritmo

1. `npm run git:ensure-sync`
2. `npm run task:claim` — assume a proxima `pending` e publica em `main`
3. Implementar spec, banco/scripts se a task pedir, testes verdes
4. `npm run git:integrate` apos commit de codigo
5. `npm run task:done -- --id <ID>`

Se travar: `npm run task:release -- --id <ID> --reason "..."`
