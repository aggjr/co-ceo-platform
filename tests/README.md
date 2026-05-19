# Testes — co-CEO Platform

## Comandos

| Comando | O que faz |
|---------|-----------|
| `npm test` | Todos os testes Jest (unit + middleware) |
| `npm run test:regression` | Reteste completo + relatório + cobertura |
| `npm run test:regression:impact` | Só testes afetados pelo `git diff` |
| `npm run test:regression:persist` | Completo + grava em `quality_test_runs` |
| `npm run test:catalog:sync` | Atualiza `catalog.json` |
| `npm run test:impact:plan` | Gera `reports/impact-plan.json` sem rodar testes |

## Arquivos

- `catalog.json` — unidades de código ↔ arquivos de teste
- `coverage-policy.json` — **metas por unidade** (criticidade, funcionalidades, % e casos mínimos)
- `impact-map.json` — diff Git → suítes mínimas
- `reports/regression-latest.json` — último resultado (painel Cockpit)

## Painel

Cockpit → **Qualidade** (`/cockpit/platform/quality`) — requer `quality:regression:read` (plataforma).
