# Fila de trabalho

> **Arquiteto (Augusto):** descreva as proximas tarefas nos blocos `## ID` abaixo (texto livre + campos).  
> **Agentes:** usem `npm run task:claim` — o script atualiza `status` / `agente` e publica em `main`. Nao marquem claim a mao.

Copie o bloco modelo, cole no fim da lista e preencha.

---

## _MODELO

prioridade: 50
status: pending
agente:
spec:
assumida:
concluida:
release:

titulo: Titulo curto para o quadro

Descreva aqui o trabalho em quantos paragrafos precisar.
Criterio de aceite, arquivos, banco remoto, etc.

---

## CONC-00

prioridade: 0
status: claimed
agente: antigravity-gamer
spec: 
assumida: 2026-05-29T23:32:46.808Z
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: done
concluida: 2026-05-29T23:14:44.728Z
release: V0.0.222

titulo: prioridade: 0

prioridade: 0
status: claimed
agente: antigravity-gamer
assumida: 2026-05-29T23:09:34.117Z

titulo: prioridade: 0

prioridade: 0
status: claimed
agente: antigravity-gamer
assumida: 2026-05-29T22:59:21.958Z

titulo: prioridade: 90

prioridade: 90
status: pending
spec: tasks/wave-conciliacao/00-patrimony-daily-rebuild.md

titulo: Rebuild patrimônio diário + gráfico Resultado histórico

PatrimonyDailyRebuildService, API rebuild, dashboard com method=mtm_economic.
Doc: docs/architecture/invest_conciliacao.md. Bloqueia correção do gráfico após saneamento do livro.

---

---

---

---

---

## CONC-01

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: cancelled
spec: tasks/wave-conciliacao/01-reconcile-cash-api.md
titulo: (cancelada — absorvida por CONC-12/14)

---

---

---

---

---

## CONC-02

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: cancelled
spec: tasks/wave-conciliacao/02-reconcile-cash-ui.md
titulo: (cancelada — absorvida por CONC-13/14)

---

---

---

---

---

## CONC-03

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: cancelled
spec: tasks/wave-conciliacao/03-reconcile-assets-api.md
titulo: (cancelada — absorvida por CONC-12/13)

---

---

---

---

---

## CONC-04

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: cancelled
spec: tasks/wave-conciliacao/04-reconcile-assets-ui.md
titulo: (cancelada — absorvida por CONC-13)

---

---

---

---

---

## CONC-10

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 88

prioridade: 88
status: pending
spec: tasks/wave-conciliacao/10-reconciliation-session-schema.md

titulo: Schema sessão de conciliação (MySQL + store)

Doc: docs/architecture/invest_reconciliacao_sessao.md. Paralelo com CONC-00/11.

---

---

---

---

---

## CONC-11

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 88

prioridade: 88
status: pending
spec: tasks/wave-conciliacao/11-reconciliation-audit-sweep.md

titulo: Varredura completa ReconciliationAuditService

17 dimensões; issues viram pendingDecisions (sem auto-fix). Gate antes de fechar dia.

---

---

---

---

---

## CONC-12

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 92

prioridade: 92
status: pending
spec: tasks/wave-conciliacao/12-reconciliation-session-service.md

titulo: Sessão conciliação — API dia a dia + materialize

resolve/close estrito; decisão humana obrigatória (§J). Depende CONC-00,10,11.

---

---

---

---

---

## CONC-13

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 90

prioridade: 90
status: pending
spec: tasks/wave-conciliacao/13-reconciliation-wizard-ui.md

titulo: UI wizard conciliação (pasta notas, dia a dia)

Painel Pendências do dia + ações explícitas. Depende CONC-12.

---

---

---

---

---

## CONC-14

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 82

prioridade: 82
status: pending
spec: tasks/wave-conciliacao/14-reconciliation-cash-phase.md

titulo: Fase extrato na sessão (após notas 100%)

Bloqueado até notes_complete. Depende CONC-13.

---

---

---

---

---

## CONC-15

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 70

prioridade: 70
status: pending
spec: tasks/wave-conciliacao/05-catalog-deploy.md

titulo: Menu e catálogo UI conciliação + deploy

Item único Conciliação no menu. Depende CONC-13.

---

---

---

---

---

## W3-02

prioridade: 0
status: pending
agente: 
spec: 
assumida: 
concluida: 
release: 

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 0

prioridade: 0
status: pending

titulo: prioridade: 80

prioridade: 80
status: done
agente: antigravity-gamer
spec: tasks/wave-3/02.md
assumida: 2026-05-28T02:46:53.398Z
concluida: 2026-05-28T12:32:01.022Z
release: V0.0.165

titulo: INVEST: recalcular resultados por ação desde 2026

INVEST: recalcular resultados por ação desde 2026

