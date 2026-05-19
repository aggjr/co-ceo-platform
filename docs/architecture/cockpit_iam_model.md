# co-CEO — Cockpit e Modelo de Controle de Acesso (IAM)

> **Status:** Especificação normativa v1.0 — base para API e UI do Cockpit.  
> **Audiências:** Equipe co-CEO (plataforma) e administradores do cliente (organização contratante).

---

## 1. Visão geral

O **Cockpit** é o módulo CORE de governança. Ele não é um ERP: concentra **contratos, usuários, papéis, permissões, UI, campos, storage e impersonation**.

```text
                    ┌─────────────────────────────────────┐
                    │     COCKPIT — Visão Plataforma      │
                    │  (equipe co-CEO, scope = global)    │
                    │  Todos os contratos e configurações │
                    └─────────────────┬───────────────────┘
                                      │ espelha / audita
                    ┌─────────────────▼───────────────────┐
                    │     COCKPIT — Visão Cliente         │
                    │  (admin do contrato, scope = node)  │
                    │  Sua árvore, equipe, papéis, uso    │
                    └─────────────────────────────────────┘
```

**Regra:** toda configuração feita pelo cliente é **visível** pela equipe co-CEO (somente leitura ou com trilha de auditoria). Alterações sensíveis do cliente podem exigir permissão explícita `cockpit:iam:manage_team`.

---

## 2. Entidades e responsabilidades

| Entidade | Função |
|----------|--------|
| **organization** | Nó na árvore (holding, empresa, loja). `path` materializado. |
| **contract** | Aperto comercial: liga `organization_id` raiz do cliente a módulos (`contract_modules`). |
| **contract_users** | Usuários autorizados naquele contrato + nó padrão. |
| **user** | Identidade global (e-mail único). |
| **role** | Papel: `scope` global ou node; pode ser da plataforma ou da organização. |
| **permission** | Capacidade atômica (`module:resource:action`). |
| **user_role** | Usuário + papel + `organization_id` + `contract_id` (contexto). |
| **access_resource** | Catálogo de telas, rotas, botões, APIs. |
| **role_resource_grant** | allow/deny por papel sobre recurso de UI. |
| **field_permission** | read / write / hidden / mask por papel e tabela.campo. |
| **iam_config_audit** | Auditoria de mudanças de configuração IAM (antes/depois). |

---

## 3. Níveis de controle (do mais grosso ao mais fino)

| Nível | Mecanismo | Exemplo |
|-------|-----------|---------|
| **Módulo** | `contract_modules` | Cliente comprou INVEST mas não CASH |
| **API / ação** | `permissions` + middleware | `invest:ledger:write` |
| **Dado (linha)** | Gateway + tenant scope | Só sub-árvore do `organization_id` |
| **Campo** | `field_permissions` | `managerial_avg_price` hidden para perfil "Operador" |
| **Tela / rota** | `access_resources` + `role_resource_grants` | `screen.invest.dashboard` |
| **Botão** | `access_resources` type `button` | `button.invest.ledger.export` |

Ordem de avaliação em runtime:

1. Contrato ativo e módulo licenciado  
2. Permissão API (`AuthorizationService.can`)  
3. Escopo de organização (JWT + gateway)  
4. Grant de UI (para frontend: `GET /api/cockpit/me/access-matrix`)  
5. Política de campo (leitura máscara / escrita bloqueia)

---

## 4. Papéis: plataforma vs cliente

| Tipo | `owner_organization_id` | Quem cria | Quem atribui |
|------|-------------------------|-----------|--------------|
| **Plataforma** | `NULL` | co-CEO (seed) | Apenas equipe global |
| **Organização** | id da raiz do cliente | Admin do cliente ou co-CEO | Admin do cliente (subárvore) ou co-CEO |

Papéis sistema (`is_system = true`) não podem ser excluídos. O cliente pode **clonar** um papel sistema para customizar grants.

Papéis seed plataforma:

- `PLATFORM_SUPER_ADMIN` — global, todas as permissões  
- `PLATFORM_SUPPORT` — global, leitura + impersonation  
- `PLATFORM_ACCOUNT_MANAGER` — global, contratos e módulos  

Papéis seed organização (template por contrato):

- `ORG_OWNER` — node, administra equipe e IAM na subárvore  
- `ORG_MANAGER` — node, opera módulos sem IAM  
- `ORG_VIEWER` — node, somente leitura  

---

## 5. JWT e contexto de sessão

Payload mínimo após login ou seleção de contexto:

```json
{
  "userId": "uuid",
  "roleId": "uuid",
  "userRoleId": "uuid",
  "contractId": "uuid",
  "organizationId": "uuid | null",
  "scope": "global | node",
  "impersonatorId": "uuid | null",
  "permVersion": 1
}
```

- **`permVersion`:** incrementado quando papéis/permissões do usuário mudam → força re-login.  
- **Impersonation:** `impersonatorId` preenchido; auditoria em `audit_logs` e `iam_config_audit`.  
- **Múltiplos contextos:** login retorna `contexts[]`; `POST /api/auth/select-context` emite JWT definitivo.

---

## 6. Cockpit — superfícies de API (implementação faseada)

### 6.1 Plataforma (requer `scope: global` + permissões cockpit)

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/cockpit/platform/contracts` | `cockpit:contracts:read` |
| GET | `/api/cockpit/platform/contracts/:id` | `cockpit:contracts:read` |
| GET | `/api/cockpit/platform/contracts/:id/iam` | `cockpit:iam:read` |
| GET | `/api/cockpit/platform/contracts/:id/storage` | `cockpit:storage:read` |
| POST | `/api/auth/impersonate` | `core:impersonate:execute` |

### 6.2 Cliente (requer papel com `cockpit:iam:manage_team` ou leitura)

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/cockpit/me` | autenticado |
| GET | `/api/cockpit/me/access-matrix` | autenticado (UI + campos) |
| GET | `/api/cockpit/me/team` | `cockpit:team:read` |
| POST | `/api/cockpit/me/team` | `cockpit:team:write` |
| GET | `/api/cockpit/me/roles` | `cockpit:iam:read` |
| PATCH | `/api/cockpit/me/roles/:roleId` | `cockpit:iam:manage_team` |
| GET | `/api/cockpit/me/storage` | `cockpit:storage:read` |

Toda mutação IAM grava em **`iam_config_audit`** via gateway.

---

## 7. Interface futura (UX)

### Equipe co-CEO

- Árvore de organizações / contratos (N níveis)  
- Painel lateral: usuários, papéis, módulos, storage, últimas alterações IAM  
- Ações: impersonate (nova aba), editar contrato, suspender módulo  

### Cliente (simples e escalável)

- Wizard: convidar usuário → escolher papel → escolher unidade (nó)  
- Lista de equipe com papel e unidade (sem expor árvore inteira se não necessário)  
- Uso de dados: barra de storage / limite do plano  
- Opcional avançado: “Personalizar campos” e “Ocultar botões” por papel (templates)

A API `access-matrix` devolve JSON pronto para o frontend esconder botões e colunas sem segunda chamada por tela.

---

## 8. Integração com o Gateway

- Mutações de negócio: sempre `CoCeoDataGateway`.  
- Mutações IAM: gateway + `iam_config_audit`.  
- **Escrita de campo:** `FieldPolicyService.assertCanWrite(roleId, orgId, table, field)`.  
- **Leitura:** `FieldPolicyService.filterRow(roleId, orgId, table, row)` antes de serializar JSON.

Autenticação bootstrap (login): `AuthRepository` → `CoCeoDataGateway.readQuery` com `authBootstrapContext` (`SYSTEM_INSTALLER`) e queries `auth_*` marcadas `bootstrapOnly` em `GatewayReadQueries.ts`.

---

## 9. Matriz de permissões (catálogo inicial)

Ver seed `005_permissions_catalog.sql` / `permissions.seed.ts`. Convenção:

```text
{module}:{resource}:{action}
```

Módulos: `core`, `cockpit`, `invest`, `cash`, `stockspin`.

Ações: `read`, `write`, `delete`, `execute`, `manage`.

---

## 10. Provisionamento IAM em escala (futuro)

Para o piloto (holding demo), scripts offline via `CoCeoDataGateway` + `SYSTEM_INSTALLER` (`seed:holding`, `seed:iam`, `seed:invest-access`) são suficientes.

Quando escalar para vários contratos/clientes, considerar endurecer:

- Executar grants **somente em pipeline** (CI/CD ou job interno), não manualmente em produção.
- Ferramenta interna co-CEO (Cockpit plataforma) para “licenciar módulo / atribuir papel”, com trilha de quem executou.
- Evitar novos scripts ad hoc por cliente; reutilizar catálogo IAM (`005_iam_catalog`) e APIs auditadas.

O script `scripts/grant-invest-access-holding.ts` permanece como reparo idempotente de desenvolvimento até existir esse fluxo.

---

## 11. Histórico

| Versão | Data | Nota |
|--------|------|------|
| 1.0 | 2026-05-18 | Modelo Cockpit + IAM em 5 níveis |
| 1.1 | 2026-05-18 | Nota de roadmap — provisionamento IAM em escala |
