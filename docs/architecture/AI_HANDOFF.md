# AI Handoff — co-CEO Platform

Documento neutro de LLM. Qualquer assistente de IA (Cursor, Antigravity, GitHub Copilot, etc.) deve ler isto antes de mexer no código. Cursor lê adicionalmente as regras estritas em `.cursor/rules/co-ceo.mdc` — este arquivo é a versão mais longa e contextualizada.

## 1. O que é este projeto

co-CEO Platform é um **framework guarda-chuva** que hospeda múltiplos módulos de negócio (CASH, STOCKSPIN, INVEST, etc.). Cada módulo é assinatura B2B SaaS independente. O alvo são PMEs (CMMI nível 1-2) que precisam de inteligência estratégica sem pagar ERP grande.

Não é ERP. Não é PDV. Integra-se a eles (apenas lê) e devolve apoio à decisão estratégica para o CEO.

**Fundações teóricas que devem permear a IA conselheira (IVA):**
- **TOC** (Teoria das Restrições) — sempre identifique o gargalo antes de sugerir otimização local
- **GQM evoluído** — árvore de indicadores operacional → tático → estratégico
- **Zachman leve** — modelar cliente em 6 perspectivas
- **CMMI / BPMM** — calibrar complexidade da sugestão pela maturidade do cliente

## 2. Stack atual

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 20+ / Express / TypeScript |
| Banco | MySQL 8+ (`co_ceo_db`) |
| Frontend (em migração) | Vite + Solid.js (saindo de Vanilla JS) |
| Auth | JWT + impersonation rastreável |
| Testes | Jest (unit-core, unit-middleware) |

Detalhes em `docs/architecture/co_ceo_architecture.md`.

## 3. Doutrina arquitetural inegociável

### 3.1 Barramento canônico, sempre

Todo dado de fora (BTG, MyProfit, ERP cliente, extratos, cotações) entra via **translator** que normaliza para o **modelo canônico** e publica no barramento. Engines consomem só do barramento, **nunca** importam parser de fornecedor diretamente.

Razão: o framework atende vários clientes com fontes heterogêneas. Acoplar engine a fornecedor mata a portabilidade.

### 3.2 DAL único (`CoCeoDataGateway`)

Localização: `src/core/dal/`. Toda mutação ou leitura de negócio passa pelo gateway. Garante: whitelist de tabelas, isolamento hierárquico de tenant, audit trail com impersonation, soft-delete, hodômetro de storage.

**Proibido**: `pool.query(...)` em controller ou service de domínio. Use `gateway.findWhere`, `gateway.insert`, `gateway.transaction(...)` etc.

### 3.3 Zero hardcode de dados de domínio

Strikes de opção, catálogos de ativos, âncoras de saldo, parâmetros financeiros — nada disso fica em código. Fonte é sempre banco / livro razão / barramento.

Casos reais do que **não** fazer (já erradicados do repo):
- `optionStrikeCatalog.ts` com 12 strikes fixos
- `btgExtractMay182026.ts` com lançamentos de uma data específica
- `BTG_CASH_STATEMENT_BALANCE_2026_05_19 = 2760.96` como constante

### 3.4 Regras de negócio em código, não em `.docx`

Doc binária não é diff-ável, não é revisável em PR, não é indexável por busca. Regras de negócio críticas ficam **em código** com comentários estruturados que permitem gerar documentação automaticamente.

### 3.5 Idempotência

Toda mutação aceita chave idempotente. Em particular: lançamentos de livro razão com mesma data + mesmo ativo + mesmos valores = provável duplicação. Sistema pede confirmação ou extrato que valide.

### 3.6 Soft-delete e audit

`DELETE` físico proibido em tabelas de negócio. `deleted_at` + audit trail é a regra. Hard-delete só por rotina assíncrona após prazos LGPD.

## 4. Modelo de domínio do INVEST (módulo em foco)

### 4.1 Sem lotes, sem multiplicador

Quantidade no livro razão é **em ações** (unidades do subjacente). 12.700 CALLs vendidas operam 12.700 ações da subjacente. Prêmio é unitário direto: prêmio R$ 0,50 × 12.700 = R$ 6.350 recebidos.

**NUNCA** introduza `lot_size`, `contract_multiplier`, `× 100`, ou heurística que tente detectar "qty veio em lotes". A quantidade do livro razão é a verdade.

### 4.2 Livro razão é fonte única

Tabela `invest_ledger_entries`. Snapshot `invest_assets` é projeção/view materializada derivada do livro, **não fonte concorrente**. Em caso de divergência, livro vence.

Operação canônica do livro contém:
- ativo (ticker)
- compra/venda (transaction_type)
- tipo: `stock` / `option_call` / `option_put` / `fii` / `fixed_income` / `cash`
- quantidade (em ações/unidades)
- valor da negociação
- custos: emolumentos / taxas / IRRF
- `option_strike` quando opção

### 4.3 Os três preços de uma posição

Recalculados sobre o **lote inteiro** a cada nova entrada (lote unificado fica com 1 valor de cada). Sem FIFO/LIFO.

| Preço | Cálculo |
|---|---|
| **Estrito** | Custo de compra sem descontar prêmio + soma de emolumentos/taxas |
| **B3** | Como Estrito, mas abate prêmio da PUT quando compra foi via exercício de PUT |
| **Gerencial** | Abate todas as PUTs que afetaram a ação (exercidas ou não) + abate CALLs vendidas e não realizadas durante a custódia |

### 4.4 Strike vem do livro razão

`option_strike` é campo da operação de opção no livro. Nunca de catálogo, nunca inferido do ticker B3 (o número no ticker NÃO é o strike), nunca heurística sobre sufixo E/F.

## 5. Estrutura de pastas relevante

```
src/
├── config/              — conexão MySQL e gateway singleton
├── controllers/         — handlers HTTP (finos; lógica vai pra core/)
├── core/
│   ├── auth/            — IAM, FieldPolicyService, RBAC
│   ├── dal/             — CoCeoDataGateway (único ponto de DB)
│   ├── eventbus/        — barramento (in-memory hoje, evoluir)
│   ├── invest/          — engines do INVEST (custódia, livro, pivot, etc.)
│   ├── quality/         — testes de regressão automatizados
│   └── telemetry/       — telemetria de uso
├── database/migrations/ — SQL ordenado numericamente
├── middlewares/         — Auth, RequirePermission
├── modules/             — módulos por bounded context (cash, invest, stockspin)
└── routes/api.ts        — definição de rotas Express

frontend/src/            — Vite + Solid (migração de Vanilla em curso)
tests/unit/              — Jest, organizado por área (core, controllers, invest, etc.)
tasks/                   — task specs para handoff IA (este projeto)
docs/architecture/       — documentos vivos de arquitetura
```

## 6. Convenções

### Commits
- Mensagem em português, padrão `tipo(escopo): assunto curto`.
- Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Corpo explica o **por quê**, não o "o quê" (o diff já diz o quê).
- Nunca `git commit --amend`. Sempre commit novo.
- Nunca `--no-verify` ou skip de hook.

### PRs
- Título curto (< 70 chars). Corpo descreve mudança, por que, e referencia a task spec se aplicável.
- Test plan em checklist.

### Código
- Sem comentários óbvios. Sem docstrings longos. Uma linha de comentário só quando o **por quê** não é óbvio do **o quê**.
- Sem emojis em código/commit, a menos que explicitamente pedido.
- Identificadores em inglês; mensagens ao usuário e comentários explicativos em português.
- Sem `*.md` novos fora de `docs/` e `tasks/` sem autorização.

### Testes
- Toda nova lógica de domínio precisa de teste unitário.
- Reproduza casos reais (cenários do INVEST estão em `tests/unit/invest/`).
- Critério de aceite da task spec é o contrato — sem ele verde, a task não está pronta.

## 7. Como receber e executar uma task

1. Abra `tasks/wave-N/NN-titulo.md`. Leia inteira antes de tocar código.
2. Identifique o **critério de aceite** (comando de teste / verificação).
3. Crie branch dedicado (`feat/...`, `refactor/...`, `fix/...`).
4. Faça as alterações **estritamente** no escopo da task.
5. Rode `npx tsc --noEmit` e o critério de aceite até verde.
6. Commit em português seguindo convenção.
7. Abra PR, referencie a task spec.

## 8. Quando parar e devolver para o arquiteto

- A task spec contradiz alguma regra deste documento.
- A spec menciona arquivo/função que não existe (confirme com busca antes de assumir).
- Decisão de modelagem aparece no meio da task — isso é do arquiteto.
- Critério de aceite continua vermelho após 2 tentativas honestas.
- A spec exige adicionar dependência ou criar tabela/migração sem instrução explícita.

Quando travar: descreva no PR (ou comentário) o que tentou, o erro exato, e por quê acha que precisa de decisão do arquiteto. Não invente solução para destravar.

## 9. Documentos relacionados

- `docs/architecture/co_ceo_architecture.md` — visão completa do produto, princípios, módulos, IA
- `docs/architecture/invest_module.md` — INVEST: fronteira com CASH, schema, próximos passos
- `docs/architecture/cockpit_iam_model.md` — modelo IAM normativo
- `docs/architecture/core_dal_gateway.md` — referência do gateway de dados
- `docs/architecture/regression_testing_policy.md` — política de testes
- `.cursor/rules/co-ceo.mdc` — versão concisa destas regras para auto-injeção no Cursor
- `tasks/README.md` — fluxo de trabalho com task specs
- `tasks/_template.md` — template para nova task spec
