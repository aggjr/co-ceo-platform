# co-CEO Core — Estratégia de Testes e Regressão

A viabilidade técnica de manter um sistema complexo B2B sem quebrar funcionalidades antigas a cada deploy reside exclusivamente na **automação de testes** e na **seleção correta da suíte** antes de cada versão.

> **Política normativa completa:** [regression_testing_policy.md](./regression_testing_policy.md)  
> **Status da implementação:** Documentada; infraestrutura de CI e pastas em `tests/` serão desenvolvidas na fase adequada do Core (após gateway unificado).

**Stack prevista:** Jest (unitário, módulo, integração, contrato) + Playwright (E2E).

---

## 1. Pirâmide de testes

| Nível | Foco | Exemplo no co-CEO |
|-------|------|-------------------|
| **Unitário** | Lógica pura, sem banco | Cálculo da Mira (STOCKSPIN); métricas de covered call (INVEST); `AuthMiddleware` com mocks |
| **Módulo** | Domínio de negócio isolado | `LedgerService` recalculando custódia a partir de fixtures |
| **Integração** | API → Gateway → MySQL | Franqueado 2 não lê dados do Franqueado 1; audit na mesma transação |
| **Contrato** | API vs OpenAPI | `POST /api/invest/ledger/entries` respeita schema |
| **E2E** | Navegador, fluxo real | Login → dashboard INVEST → selo “Sincronizado com B3” |
| **Regressão (bug)** | Incidente do cliente | `BUG-042`: estorno no mesmo dia não distorce preço médio |

Detalhes, gates de CI e mapa de impacto por pasta: **[regression_testing_policy.md](./regression_testing_policy.md)**.

---

## 2. Regra de ouro: onde mudou, o que testar

**Toda alteração de código** deve passar pelos testes determinados pela **localização dos arquivos** no diff (Test Impact Analysis).

- Mudança em `src/core/dal/` → testes de segurança do gateway + isolamento de tenant.
- Mudança em `src/modules/invest/` → unit + integração INVEST.
- Migration SQL → **reteste completo**.

Mudanças grandes (muitos arquivos, dependências, release) → **`test:full`** obrigatório antes do deploy.

---

## 3. Cultura de proteção (bug-driven testing)

1. Cliente reporta bug (ex.: liquidez errada com estorno no mesmo dia).
2. Desenvolvedor **não** corrige o código primeiro.
3. Cria teste automatizado que reproduz o cenário (`BUG-xxx`). O teste **falha**.
4. Corrige até o teste passar.
5. O teste permanece na base para sempre (`@regression`).

Assim a esteira bloqueia o retorno do bug em qualquer deploy futuro.

---

## 4. Cobertura de código (por unidade e funcionalidade)

Não há meta global fixa de 80%. As metas vivem em `tests/coverage-policy.json`, por unidade de código, com base em:

- **Criticidade** (P0 = transversal, P1 = módulo crítico, P2 = observabilidade, etc.)
- **Funcionalidades afetadas** (login, tenant, audit, INVEST ledger, …)
- **Metas por unidade**: % mínimo de linhas cobertas, número mínimo de casos e arquivos de teste

A cobertura **global** do Jest é apenas **informativa** no painel Cockpit. O gate de regressão compara cada unidade **ativa** com a sua meta (`npm run test:regression`).

---

## 5. Geração automática de testes

Permitida e incentivada para:

- scaffolds de arquivos `.test.ts`;
- casos unitários a partir de contratos e exemplos numéricos;
- testes de contrato a partir de OpenAPI;
- rascunhos E2E (Playwright codegen).

**Sempre com revisão humana.** Cenários de segurança (tenant, impersonation, audit) são definidos manualmente — ver §9 da política.

---

## 6. Antes de subir qualquer versão

Checklist mínimo (quando a CI estiver implementada):

- [ ] `test:impact` verde para o diff do PR
- [ ] Se aplicável: `test:full` (release, DAL, migrations, deps)
- [ ] Nenhum `@regression` / `BUG-xxx` falhando
- [ ] Unidades ativas em conformidade com `tests/coverage-policy.json`
- [ ] Tag `v*`: `test:full` + smoke E2E dos módulos em produção

---

## 7. Referência rápida de implementação futura

```text
npm run test              # desenvolvimento local
npm run test:impact       # suíte calculada pelo diff (CI no PR)
npm run test:full         # reteste completo (release / deploy)
npm run test:regression   # apenas @regression / BUG-xxx
```

Estrutura de pastas e `impact-map.yml`: ver [regression_testing_policy.md §3–4](./regression_testing_policy.md).

---

## 8. Histórico

| Versão | Data | Alteração |
|--------|------|-----------|
| 0.1 | (anterior) | Pirâmide inicial e bug-driven |
| 1.0 | 2026-05-18 | Alinhamento à política de regressão; impact analysis; cobertura incremental; geração assistida |
