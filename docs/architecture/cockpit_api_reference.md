# Cockpit — Referência rápida de API

> Requer migrations `00`, `02`, `03`, `04` e seeds via gateway: `005_iam_catalog.ts` + `001_super_admin.ts`.

## Ordem de setup do banco

1. `00_core_saas_schema.sql`
2. `02_gateway_storage_and_meter.sql`
3. `03_iam_cockpit_schema.sql`
4. `005_permissions_and_roles.sql`
5. Seeds (gateway): `npx ts-node src/database/seeds/005_iam_catalog.ts` then `CO_CEO_ADMIN_PASSWORD=... npx ts-node src/database/seeds/001_super_admin.ts`

## Autenticação

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/login` | `{ email, password }` → token ou lista de contextos |
| POST | `/api/auth/select-context` | `{ userId, userRoleId }` → token |
| GET | `/api/auth/me` | Bearer — sessão atual |
| POST | `/api/auth/impersonate` | Global — `{ targetUserId, userRoleId }` |

## Cockpit plataforma (co-CEO)

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/cockpit/platform/contracts` | `cockpit:contracts:read` |
| GET | `/api/cockpit/platform/contracts/:contractId/iam` | `cockpit:iam:read` |

## Cockpit cliente

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/cockpit/me` | autenticado |
| GET | `/api/cockpit/me/access-matrix` | autenticado (UI) |
| GET | `/api/cockpit/me/team` | `cockpit:team:read` |
| GET | `/api/cockpit/me/roles` | `cockpit:iam:read` |
| GET | `/api/cockpit/me/storage` | `cockpit:storage:read` |

## Resposta `access-matrix` (para frontend)

```json
{
  "permissions": ["invest:ledger:read", "cockpit:team:read"],
  "resources": [
    { "key": "screen.invest.dashboard", "type": "screen", "label": "...", "effect": "allow" }
  ],
  "fieldPolicies": [
    { "table_name": "invest_assets", "field_name": "managerial_avg_price", "permission_type": "hidden" }
  ]
}
```

O frontend oculta botões/telas ausentes ou com `deny` e remove colunas `hidden`.
