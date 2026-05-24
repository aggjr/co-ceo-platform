# co-CEO Platform — Política de Testes de Regressão

> **Status:** Documentação normativa (v1.0) — regras aprovadas antes da implementação da infraestrutura de CI.  
> **Implementação:** Será desenvolvida na fase de “Fundação + Qualidade”, após o `CoCeoDataGateway` unificado e as primeiras rotas INVEST.  
> **Documento relacionado:** [testing_strategy.md](./testing_strategy.md)

---

## 1. Objetivo

Garantir que **nenhuma versão** do co-CEO (Core ou módulos contratados) suba para staging ou produção sem passar pelos testes de regressão adequados ao **risco da alteração**.

Princípios:

1. **Toda mudança de código** define, pela sua localização, **quais suítes** devem rodar.
2. **Mudanças maiores** exigem **reteste completo** da plataforma (dentro do escopo dos módulos já em produção).
3. A base de testes **cresce de forma permanente** (bug-driven + novos módulos).
4. A **geração automática** de testes é permitida e incentivada, mas **nunca substitui** revisão humana nem os cenários de segurança obrigatórios.

---

## 2. Níveis de teste (pirâmide oficial)

| Nível | Sigla | O que valida | Ferramenta prevista | Velocidade |
|-------|-------|--------------|---------------------|------------|
| **Unitário** | `unit` | Funções puras, regras matemáticas, middlewares com mocks | Jest | Segundos |
| **Módulo** | `module` | Um bounded context (ex.: INVEST ledger) com dependências mockadas ou DB mínimo | Jest | Segundos a poucos minutos |
| **Integração** | `integration` | HTTP → Gateway → MySQL real (container) | Jest + Supertest + Testcontainers | Minutos |
| **Contrato** | `contract` | Resposta da API vs schema OpenAPI / snapshot JSON estável | Jest + OpenAPI | Minutos |
| **End-to-End** | `e2e` | Fluxo no navegador (login, impersonation, dashboard) | Playwright | Minutos a dezenas de minutos |
| **Regressão de bug** | `regression` | Cenário exato de um incidente reportado (tag `BUG-xxx`) | Jest (qualquer nível acima) | Conforme o caso |

> **Nota:** “Teste de módulo” não é sinônimo de “teste do pacote npm”. No co-CEO, **módulo** = domínio de negócio contratável (`INVEST`, `CASH`, `CORE`, etc.).

---

## 3. Estrutura de pastas

Layout em uso (parcialmente implementado):

```text
tests/
  unit/
    core/                 # DAL, auth helpers, hodômetro
    invest/               # PM gerencial, métricas covered call, snapshots
  parity/                 # Visão do usuário: brapi, opcoes.net vs sistema
  helpers/                # marketReference.ts (live opcional)
  module/
    invest/               # LedgerService, CustodyService (mocks + fixtures)
  integration/
    core/                 # tenant isolation, audit, impersonation
    invest/               # API + gateway + ledger
  contract/
    openapi/              # snapshots por rota versionada
  e2e/
    smoke/                # fluxos mínimos pré-deploy
    invest/               # dashboard, sync badge, boleta
  regression/             # um arquivo (ou describe) por BUG-xxx
  fixtures/               # seeds e factories reutilizáveis
  impact-map.yml          # mapa caminho → tags → suítes obrigatórias
```

**Regra de espelhamento:** o caminho em `tests/` deve refletir `src/` (ex.: `src/modules/invest/domain/` → `tests/unit/invest/domain/`).

---

## 4. Seleção de testes por localização da alteração (Test Impact Analysis)

Antes de merge ou deploy, a esteira de CI calculará a suíte mínima a partir do **diff do Git** cruzado com `tests/impact-map.yml` e, quando disponível, o **grafo de dependências** entre arquivos.

### 4.1 Mapa de impacto (normativo)

| Caminho alterado | Tags | Suítes obrigatórias no PR |
|------------------|------|---------------------------|
| `src/core/dal/**` | `core`, `security`, `dal` | `unit:core`, `integration:gateway`, `integration:tenant-isolation` |
| `src/middlewares/**` | `core`, `auth` | `unit:core`, `integration:auth` |
| `src/controllers/**` (auth) | `core`, `auth`, `security` | `unit:core`, `integration:auth`, `integration:impersonation` |
| `src/modules/invest/domain/**` | `invest` | `unit:invest` |
| `src/modules/invest/**` (services/api) | `invest` | `unit:invest`, `module:invest`, `integration:invest` |
| `src/modules/invest/api/**` (rotas públicas) | `invest`, `contract` | acima + `contract:invest` |
| `src/database/migrations/**` | `schema`, `core` | **Reteste completo** (§5) |
| `src/frontend/**/invest/**` | `invest`, `e2e` | `e2e:smoke:invest` |
| `scripts/admin/**` | `core`, `cli` | `integration:admin-scripts`, `integration:audit` |
| `docs/**` apenas | — | lint de documentação (opcional) |
| `package.json`, `package-lock.json` | `deps` | **Reteste completo** |

Alterações em múltiplas linhas do mapa **unem** as suítes (união de conjuntos, sem duplicar execução).

### 4.2 Arquivo `impact-map.yml` (futuro)

Será a fonte de verdade machine-readable. Exemplo de entrada:

```yaml
paths:
  "src/core/dal/**":
    tags: [core, security, dal]
    requires: [unit:core, integration:gateway, integration:tenant-isolation]
  "src/modules/invest/**":
    tags: [invest]
    requires: [unit:invest, integration:invest]
```

Comando previsto: `npm run test:impact` (ou equivalente) — lista e executa apenas o necessário.

---

## 5. Reteste completo (`test:full`)

### 5.1 Quando é obrigatório

O reteste completo deve rodar se **qualquer** condição abaixo for verdadeira:

| Gatilho | Motivo |
|---------|--------|
| Alteração em `src/core/dal/**` | Afeta todos os módulos que usam o gateway |
| Nova ou alterada migration em `src/database/migrations/**` | Risco de drift de schema |
| Alteração em `UserContext`, JWT, impersonation ou `audit_logs` | Segurança transversal |
| Mudança em dependências de runtime (`package.json` / lockfile) | Comportamento global imprevisível |
| PR com mais de **15 arquivos** alterados (configurável) | Heurística de mudança grande |
| PR com mais de **500 linhas** líquidas alteradas (configurável) | Heurística de mudança grande |
| Label de PR `release` ou branch `release/*` | Gate de versão |
| Tag de versão `v*` (deploy produção) | Última barreira antes do cliente |
| Falha intermitente (“flaky”) em `test:impact` | Reexecução uma vez; se persistir, exige `test:full` |

### 5.2 O que compõe o reteste completo

1. Todos os projetos Jest: `unit:*`, `module:*`, `integration:*`, `contract:*`
2. Todos os testes com tag `@regression`
3. E2E smoke global (Core + módulos ativos em produção)
4. (Opcional noturno) E2E completo do módulo INVEST

### 5.3 O que NÃO exige reteste completo

- Correção de comentário, typo em `docs/` sem mudança de comportamento documentado
- Ajuste exclusivo em `*.md` de arquitetura sem alteração de contrato de API
- Refactor interno com **mesma suíte `test:impact` verde** e cobertura incremental mantida (revisão humana no PR)

---

## 6. Pipeline de qualidade (pré-merge e pré-deploy)

Fluxo normativo quando a CI existir:

```text
Push / PR
  → Lint (TypeScript + regras arquiteturais)
  → Lint arquitetural: proibir pool.query fora de src/core/dal/**
  → test:impact (suíte calculada pelo diff)
  → Cobertura incremental (linhas alteradas)
  → Se gatilho §5: test:full
  → Aprovação humana + merge
Deploy staging/produção
  → test:full obrigatório em tag v*
  → Migrations em dry-run / ambiente espelho
```

### 6.1 Gates que bloqueiam merge

| Gate | Critério |
|------|----------|
| **Impact** | Todas as suítes exigidas por `impact-map.yml` passam |
| **Cobertura incremental** | Linhas **adicionadas ou modificadas** no diff ≥ **80%** cobertas por testes |
| **Cobertura global** (meta evolutiva) | Projeto inteiro tende a 80%; pode começar mais baixo na fase inicial se documentado no PR |
| **Regressão de bug** | Nenhum teste `@regression` ou `BUG-xxx` pode falhar |
| **Segurança** | Suíte `integration:tenant-isolation` verde em qualquer PR que toque auth ou DAL |
| **Flaky** | Teste que falha 2x seguidas sem mudança de código → issue obrigatória antes de merge |

---

## 7. Cobertura de código (metas por interferência)

### 7.1 Fonte de verdade

Arquivo **`tests/coverage-policy.json`**: para cada unidade (`core.dal`, `core.auth`, `invest`, …) define:

| Campo | Significado |
|-------|-------------|
| `criticality` | P0 (transversal), P1 (módulo crítico), P2 (baixo risco operacional) |
| `functionalities` | Funcionalidades de negócio que o código pode quebrar |
| `targets.lineCoveragePct` | Meta de linhas cobertas **naquela unidade** |
| `targets.minTestCases` / `minTestFiles` | Mínimo de casos/arquivos de teste |
| `lifecycle` | `active` (gate obrigatório) ou `planned` (módulo ainda sem gate) |

### 7.2 O que não usamos mais

- Meta global única de **80%** no repositório inteiro.
- Bloqueio de merge só pela média global (engana quando módulos críticos estão descobertos).

### 7.3 Cobertura global

Percentual global do Jest permanece **informativo** no Cockpit. O gate de `npm run test:regression` exige **conformidade das unidades ativas** com a política (testes verdes + metas da unidade).

---

## 8. Cultura bug-driven (regressão permanente)

Procedimento **obrigatório** para qualquer bug reportado por cliente ou suporte:

1. Abrir issue/ticket com id estável (ex.: `BUG-042`).
2. **Antes** do fix: commitar teste que reproduz o bug (deve falhar).
3. Corrigir o código até o teste passar.
4. Marcar o teste com `@regression` e referência `BUG-042` no nome do arquivo ou `describe`.
5. O teste **nunca** é removido sem ADR ou decisão explícita de produto (comportamento obsoleto).

Exemplo de nomenclatura:

```text
tests/regression/invest/BUG-042-estorno-mesmo-dia-pm.test.ts
```

---

## 9. Geração automática de testes

### 9.1 O que pode ser gerado automaticamente

| Tipo | Automação | Revisão humana |
|------|-----------|----------------|
| Scaffold de arquivo `.test.ts` ao criar `*.ts` em `domain/` | Sim (template/CLI) | Mínima |
| Casos unitários a partir de assinatura + exemplos numéricos | Sim (IA/CLI) | **Obrigatória** para valores “golden” |
| Testes de contrato a partir de OpenAPI | Sim | Revisão de exemplos edge |
| Factories de fixture (`tests/fixtures/`) | Parcial | Obrigatória na primeira versão |
| E2E Playwright (`codegen`) | Rascunho | **Obrigatória** (seletores e asserções de negócio) |

### 9.2 O que NÃO pode ser apenas gerado

Cenários **obrigatórios manuais** (podem usar template, mas o cenário é definido por humano):

1. Franqueado / organização A **não** lê nem altera dados da organização B.
2. Impersonation grava `impersonator_user_id` no `audit_logs`.
3. Soft delete impede `UPDATE` no registro.
4. Chave de idempotência não duplica lançamento no ledger.
5. Token `scope=node` bloqueado em rotas `requireGlobalScope`.

### 9.3 Critérios de aceite de teste gerado

Um teste gerado **não entra em `main`** se:

- contiver apenas `expect(true)` ou asserções triviais;
- estiver com `.skip` / `.todo` sem issue linkada;
- não falhar quando o bug correspondente ainda existe (para testes de regressão);
- duplicar cenário já coberto sem aumentar assertividade.

---

## 10. Pacotes mínimos de regressão por módulo

Ao declarar um módulo “em produção”, ele deve ter o pacote abaixo **verde** no `test:full`:

### 10.1 CORE (obrigatório para qualquer deploy)

- [ ] Isolamento hierárquico (materialized path)
- [ ] Audit log com before/after em transação
- [ ] Impersonation: token + auditoria
- [ ] Soft delete global em tabelas de negócio
- [ ] (Futuro) Hodômetro de storage por `organization_id`

### 10.2 INVEST (obrigatório enquanto módulo estiver ativo)

- [ ] Cálculo de preço médio gerencial (ledger bottom-up)
- [ ] Snapshot diário de patrimônio / PnL
- [ ] Métricas de covered call (retorno/notional, break-even)
- [ ] Status de sincronização de mercado (`invest_market_sync_runs` ou equivalente)
- [ ] E2E smoke: custódia visível + selo de sync

### 10.3 Módulos futuros (CASH, STOCKSPIN, …)

Cada novo módulo adiciona entrada em `impact-map.yml` + pasta em `tests/` + checklist nesta seção **antes** do primeiro cliente pagante.

---

## 11. Convenções de nomenclatura

| Elemento | Padrão |
|----------|--------|
| Arquivo unitário | `NomeDaClasse.test.ts` |
| Arquivo integração | `nome-do-fluxo.integration.test.ts` |
| Regressão de bug | `BUG-xxx-descricao-curta.test.ts` |
| Tag Jest | `@regression`, `@security`, `@slow` |
| Describe de segurança | prefixo `[SECURITY]` |
| Describe de feature | prefixo `[FEATURE]` (como em `AuthMiddleware.test.ts`) |

---

## 12. E2E e impersonation (regras de produto testáveis)

Quando o front de suporte existir, a suíte E2E deve validar:

1. Admin logado na **aba 1** permanece no contexto original após abrir emulação na **aba 2**.
2. Aba emulada exibe banner visível: usuário emulado + admin emulador.
3. Emulação **não** exige senha do usuário alvo.
4. Token de emulação expira antes do token normal (ex.: 1h vs 8h).

---

## 13. Responsabilidades

| Papel | Responsabilidade |
|-------|------------------|
| **Desenvolvedor** | Rodar `test:impact` localmente antes do push; criar teste antes do fix de bug |
| **Revisor de PR** | Confirmar que o mapa de impacto foi respeitado; recusar PR sem teste em mudança de regra de negócio |
| **CI** | Calcular suíte, cobertura incremental, bloquear merge |
| **Release** | Garantir `test:full` + migrations em staging |

---

## 14. Paridade de mercado (visão do usuário) — implementado

Testes em `tests/parity/` validam **dados exibidos**, não só status HTTP:

| Verificação | Fonte externa | Arquivo de referência |
|-------------|---------------|------------------------|
| Cotação de ação ≠ PM | brapi (live opcional) | `tests/parity/marketQuoteUserExpectation.test.ts` |
| Strike/vencimento de opção | opcoes.net (fixture + parser) | `tests/parity/opcoesNetOptionCatalog.test.ts` |

- **Offline (CI):** regras de `portfolioMapper` + fixture `tests/fixtures/opcoes-net-prio3-expiration.json`.
- **Live:** `npm run test:parity:live` com `BRAPI_TOKEN` — não bloqueia CI sem token.

Unidade de política: `invest.market-parity` em `tests/coverage-policy.json`.

---

## 15. Metas proporcionais (sem teto fixo ~100)

1. **Jest / catálogo:** `tests/coverage-policy.json` com `targets.proportional: true` — `minTestCases` sobe com arquivos e linhas em `sourcePaths` (`scripts/lib/test-proportionality.js`). Sincronizar: `npm run test:catalog:sync`.
2. **Fuzzer de API:** sementes deduplicadas por **payload** (mesmo conjunto de entrada), cap `max(100, min(500, endpoints × 25))` — ver `scripts/lib/fuzzer-seed-pool.js`.
3. **Não descartar** casos de teste aleatoriamente; se a suíte crescer, revisar **conjuntos** (unidade funcional no catálogo) e duplicatas, não cortar por índice.

---

## 16. Fase de implementação (quando desenvolver)

A infraestrutura **não** deve anteceder o gateway unificado, mas a **documentação é normativa desde já**: novos PRs devem seguir estas regras na medida do possível (ex.: criar testes manuais em `tests/` mesmo antes do `impact-map.yml` existir).

Ordem sugerida de implementação:

1. Dependências Jest/ts-jest/supertest no `package.json` + scripts `test`, `test:unit`, `test:integration`.
2. Projetos Jest múltiplos (`unit-core`, `integration-gateway`, …).
3. `tests/impact-map.yml` + script `test:impact`.
4. GitHub Action (ou equivalente) com gates §6.
5. Testcontainers MySQL para integração.
6. Templates `generate:test` para domain e OpenAPI contract.
7. Playwright smoke + pacote INVEST §10.2.

---

## 17. Histórico de versões

| Versão | Data | Alteração |
|--------|------|-----------|
| 1.0 | 2026-05-18 | Política inicial: impact analysis, reteste completo, geração assistida, pacotes por módulo |
| 1.1 | 2026-05-23 | Paridade brapi/opcoes.net, metas proporcionais, gate INVEST ativo |
