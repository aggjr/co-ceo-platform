# co-CEO Core — CoCeoDataGateway (implementação)

> Substitui `DataWrapper`, `SecureRepository` e `TransactionManager` legados.

## Responsabilidades

| Recurso | Comportamento |
|---------|----------------|
| **Whitelist** | `TableRegistry` — só tabelas registradas |
| **Tenant scope** | `SecurityScopeResolver` — `path LIKE ?` parametrizado |
| **Audit** | `audit_logs` na mesma transação; `impersonator_user_id` do JWT |
| **Soft delete** | `softDelete()` — sem DELETE físico em tabelas de negócio |
| **Hodômetro** | `StorageMeter` — delta em `organization_storage_ledger` + `organizations.storage_bytes_used` |
| **Limite de plano** | Bloqueio com `STORAGE_LIMIT_EXCEEDED` (HTTP 402) |

## Uso

```typescript
import pool from './config/database';
import { CoCeoDataGateway } from './core/dal';

const gateway = new CoCeoDataGateway(pool);

await gateway.insert(req.userContext!, 'invest_assets', {
  id: crypto.randomUUID(),
  asset_ticker: 'PRIO3',
  asset_type: 'stock',
});

const storage = await gateway.getOrganizationStorage(context, context.organizationId!);
```

## Migrations

Executar `02_gateway_storage_and_meter.sql` após o schema core.

## API do gateway

| Operação | Método | Notas |
|----------|--------|--------|
| Inserir | `insert` | Audit + hodômetro (tenant) |
| Atualizar | `update` | Por PK |
| Soft delete | `softDelete` | Tabelas com `deleted_at` |
| Revogar vínculo IAM | `deleteMatching` | Somente `SYSTEM_INSTALLER`, tabelas `allowHardDelete` |
| Buscar por PK | `findById` | Respeita escopo tenant |
| Buscar por filtros | `findWhere` | Colunas = AND, limite padrão 500 |
| Joins / relatórios | `readQuery` | Catálogo em `GatewayReadQueries.ts` |
| Hodômetro | `getOrganizationStorage` | Leitura interna |

## Scripts administrativos

Devem usar `UserContext` com `userId: SYSTEM_INSTALLER` e chamar o mesmo gateway (nunca `pool.query` em tabelas de negócio).

| Tipo | Como executar |
|------|----------------|
| **DDL** (CREATE/ALTER) | `node scripts/run-migration.js src/database/migrations/…sql` |
| **Catálogo IAM / seeds de negócio** | `npm run seed:iam`, `seed:admin`, `seed:holding` |
| **Runtime (API)** | `dataGateway` (`src/config/gateway.ts`) + JWT do usuário |

Seeds IAM gravam `audit_logs` (via gateway, inclusive `DELETE` em vínculos) e `iam_config_audit` (via `IamAuditService`).

Login e resolução de permissões (`AuthRepository`) usam `readQuery` com contexto `SYSTEM_INSTALLER` (`authBootstrapContext`) e consultas marcadas `bootstrapOnly` no catálogo — usuários autenticados não podem invocar essas queries.

Exceções restantes de `pool.query`: health check (`SELECT 1`), DDL em migrações, e leituras internas de `OrgScopeService` / `FieldPolicyService` usadas pelo próprio gateway.
