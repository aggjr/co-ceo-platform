# TASK FASE 2 — Abertura e Caixa: migração idempotente e eliminação de duplicidade

**Documento base:** `docs/architecture/invest_reconciliacao_plano_rigido_eventos.md` seção 3 e 3.1
**Pré-requisito:** Fase 1 concluída — travas estruturais ativas.
**Objetivo:** Eliminar duplicidade entre `financial_accounts.opening_balance` e perna de abertura em `financial_ledger_entries`.

---

## Contexto

Hoje o sistema pode somar o saldo de `financial_accounts.opening_balance` e uma perna de abertura em `financial_ledger_entries` ao mesmo tempo, gerando caixa duplo. A correção é: migrar o saldo para uma perna de ledger com evento próprio e zerar o campo `opening_balance`.

A migração deve ser **idempotente** — rodar duas vezes não cria duas pernas.

---

## Arquivo 1 — `src/core/invest/OpeningBalanceMigrationService.ts` (NOVO)

Criar este arquivo do zero:

```typescript
import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';

const OPENING_SOURCE_REF = 'INVEST-OPENING-2026-01-01';
const OPENING_DATE = '2026-01-01';
const MONEY_TOL = 0.01; // R$ 0,01 de tolerância

export type OpeningMigrationReport = {
  accountsProcessed: number;
  legsCreated: number;
  legsAlreadyExisted: number;
  zeroed: number;
  blocked: { accountId: string; reason: string }[];
};

export class OpeningBalanceMigrationService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Executa a migração idempotente de opening_balance → financial_ledger_entries.
   * Seguro para rodar múltiplas vezes. Bloqueia se houver divergência > R$ 0,01.
   */
  async migrate(ctx: UserContext): Promise<OpeningMigrationReport> {
    const report: OpeningMigrationReport = {
      accountsProcessed: 0,
      legsCreated: 0,
      legsAlreadyExisted: 0,
      zeroed: 0,
      blocked: [],
    };

    // 1. Garantir evento de abertura único
    const openingEvent = await this.ensureOpeningEvent(ctx);

    // 2. Carregar todas as contas financeiras INVEST da organização
    const accounts = await this.gateway.findWhere(ctx, 'financial_accounts', {
      source_module: 'INVEST',
    });

    for (const account of accounts) {
      report.accountsProcessed++;
      const accountId = String(account.id);
      const openingBalance = Number(account.opening_balance ?? 0);
      const openingDate = String(account.opening_date ?? OPENING_DATE).slice(0, 10);

      try {
        await this.migrateAccount(ctx, {
          accountId,
          openingBalance,
          openingDate,
          openingEventId: openingEvent.id,
          report,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.blocked.push({ accountId, reason: msg });
      }
    }

    return report;
  }

  private async migrateAccount(
    ctx: UserContext,
    input: {
      accountId: string;
      openingBalance: number;
      openingDate: string;
      openingEventId: string;
      report: OpeningMigrationReport;
    }
  ): Promise<void> {
    const { accountId, openingBalance, openingDate, openingEventId, report } = input;

    // 3. Procurar perna de abertura já existente para esta conta
    const existingLegs = await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      { account_id: accountId, business_event_id: openingEventId }
    );

    const existingLeg = existingLegs.find(
      (l) =>
        String(l.transaction_date).slice(0, 10) === openingDate &&
        (String(l.metadata?.legacy_op ?? '') === 'opening_balance' ||
          String(l.external_ref ?? '').startsWith('OPENING-CASH-'))
    );

    if (existingLeg) {
      // Perna já existe — validar divergência
      const legAmount = Number(existingLeg.direction === 'outflow' ? -existingLeg.amount : existingLeg.amount);
      const delta = Math.abs(legAmount - openingBalance);

      if (openingBalance !== 0 && delta > MONEY_TOL) {
        throw new Error(
          `Perna de abertura divergente: ledger=${legAmount}, opening_balance=${openingBalance}, delta=${delta}`
        );
      }

      // Sem divergência — apenas garantir que opening_balance está zerado
      if (Number(existingLeg.account?.opening_balance ?? openingBalance) !== 0) {
        await this.gateway.update(ctx, 'financial_accounts', accountId, {
          opening_balance: 0,
        });
        report.zeroed++;
      }

      report.legsAlreadyExisted++;
      return;
    }

    // 4. Perna não existe — criar se opening_balance != 0
    if (Math.abs(openingBalance) < MONEY_TOL) {
      // opening_balance já é zero e não há perna — nada a fazer
      return;
    }

    await this.gateway.insert(ctx, 'financial_ledger_entries', {
      account_id: accountId,
      business_event_id: openingEventId,
      transaction_date: openingDate,
      settlement_date: openingDate,
      amount: Math.abs(openingBalance),
      direction: openingBalance >= 0 ? 'inflow' : 'outflow',
      status: 'cleared',
      external_ref: `OPENING-CASH-${accountId}-${openingDate}`,
      metadata: JSON.stringify({
        legacy_op: 'opening_balance',
        migrated_from: 'financial_accounts.opening_balance',
        original_value: openingBalance,
      }),
    });

    // Zerar opening_balance na conta
    await this.gateway.update(ctx, 'financial_accounts', accountId, {
      opening_balance: 0,
    });

    report.legsCreated++;
    report.zeroed++;
  }

  private async ensureOpeningEvent(
    ctx: UserContext
  ): Promise<{ id: string }> {
    const existing = await this.gateway.findWhere(ctx, 'business_events', {
      source_ref: OPENING_SOURCE_REF,
    });

    if (existing.length > 0) {
      return { id: String(existing[0]!.id) };
    }

    const id = await this.gateway.insert(ctx, 'business_events', {
      event_kind: 'opening_balance',
      occurred_on: OPENING_DATE,
      settles_on: OPENING_DATE,
      source_ref: OPENING_SOURCE_REF,
      source_module: 'INVEST',
      total_net: 0,
      metadata: JSON.stringify({
        kind: 'trusted_opening_snapshot',
        description: 'Abertura confiável INVEST 2026-01-01',
      }),
    });

    return { id };
  }
}
```

---

## Arquivo 2 — `src/core/invest/cashBalanceService.ts` (NOVO ou adaptar existente)

O cálculo de saldo deve **nunca** somar `opening_balance` quando já existe perna de abertura.

Criar ou atualizar `src/core/invest/CashBalanceService.ts`:

```typescript
import type { CoCeoDataGateway, UserContext } from '../dal';

export type CashSnapshot = {
  settledCash: number;      // caixa liquidado (cleared) até a data
  inTransit: number;        // pendências D+n ainda não liquidadas
  cashWithTransit: number;  // settledCash + inTransit (visão gerencial)
};

export class CashBalanceService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async getSnapshot(ctx: UserContext, accountId: string, asOfDate: string): Promise<CashSnapshot> {
    const legs = await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      { account_id: accountId }
    );

    let settledCash = 0;
    let inTransit = 0;

    for (const leg of legs) {
      const date = String(leg.transaction_date ?? '').slice(0, 10);
      if (date > asOfDate) continue;

      const signal = leg.direction === 'inflow' ? 1 : -1;
      const amount = Number(leg.amount ?? 0) * signal;

      if (leg.status === 'cleared') {
        settledCash += amount;
      } else if (leg.status === 'pending') {
        // Saldo em trânsito: operações ocorridas mas não liquidadas até asOfDate
        const settles = String(leg.settlement_date ?? '').slice(0, 10);
        if (settles > asOfDate) {
          inTransit += amount;
        }
      }
    }

    // REGRA CRÍTICA: financial_accounts.opening_balance é tratado como ZERO
    // quando existe perna de abertura no ledger. Nunca somar os dois.
    // (após Fase 2, opening_balance sempre será 0 — esta guarda é defensiva)

    return {
      settledCash: Math.round(settledCash * 100) / 100,
      inTransit: Math.round(inTransit * 100) / 100,
      cashWithTransit: Math.round((settledCash + inTransit) * 100) / 100,
    };
  }
}
```

---

## Arquivo 3 — `src/core/invest/PatrimonyMtmDailyEngine.ts`

### Corrigir dupla contagem de trânsito

Localizar `economicCashAtDate` e o trecho onde o patrimônio é calculado.

O problema documentado (seção 4.2 do plano):
- `economicCashAtDate` retorna `cashIncludingTransit`
- O engine depois soma `pendingSettlements` de novo

**Corrigir para:**

```typescript
// ANTES (problema):
const cash = await this.economicCashAtDate(ctx, date); // já inclui trânsito
const patrimony = positionsValue + cash + pendingSettlements; // ERRADO: conta trânsito duas vezes

// DEPOIS (correto):
const { settledCash, inTransit } = await this.cashBalance.getSnapshot(ctx, accountId, date);
// Usar APENAS settledCash no patrimônio base.
// inTransit entra UMA VEZ como componente separado.
const patrimony = positionsValue + settledCash + inTransit;
// NÃO somar pendingSettlements separadamente se já está em inTransit.
```

**Regra:** `patrimony = positionsValue + settledCash + inTransit` onde cada componente vem de uma fonte única. `inTransit` **nunca** entra duas vezes.

Injetar `CashBalanceService` no construtor do engine:

```typescript
export class PatrimonyMtmDailyEngine {
  private readonly cashBalance: CashBalanceService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.cashBalance = new CashBalanceService(gateway);
  }
  // ...
}
```

---

## Arquivo 4 — Endpoint para executar a migração

Adicionar em `ReconcileController`:

```typescript
/**
 * POST /api/invest/reconcile/migrate-opening-balance
 * Executa migração idempotente de opening_balance → financial_ledger_entries.
 */
migrateOpeningBalance = async (req: Request, res: Response): Promise<Response> => {
  const ctx = req.userContext!;
  if (!ctx.organizationId) {
    return res.status(400).json({ success: false, error: 'Personifique a holding.' });
  }
  try {
    const { OpeningBalanceMigrationService } = await import(
      '../core/invest/OpeningBalanceMigrationService'
    );
    const service = new OpeningBalanceMigrationService(this.gateway);
    const report = await service.migrate(ctx);

    const hasBlocked = report.blocked.length > 0;
    return res.status(hasBlocked ? 409 : 200).json({
      success: !hasBlocked,
      message: hasBlocked
        ? `Migração parcial — ${report.blocked.length} conta(s) bloqueada(s). Revisar manualmente.`
        : `Migração concluída: ${report.legsCreated} perna(s) criada(s), ${report.zeroed} conta(s) zerada(s).`,
      report,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err) });
  }
};
```

Adicionar rota em `src/routes/api.ts`:

```typescript
router.post(
  '/invest/reconcile/migrate-opening-balance',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  reconcile.migrateOpeningBalance.bind(reconcile)
);
```

---

## Arquivo 5 — `src/core/invest/HoldingPurgeKeepOpeningService.ts`

### Garantir que o reset preserva o evento de abertura e suas pernas

Localizar o método `purgeKeepOpening`. Adicionar condição para **não deletar** entradas com `source_ref = 'INVEST-OPENING-2026-01-01'`:

```typescript
// Na lista de eventos a manter (além de OPENING existente):
const PRESERVE_SOURCE_REFS = ['INVEST-OPENING-2026-01-01'];

// Ao fazer softDelete em business_events, excluir esses refs:
// WHERE source_ref NOT IN ('INVEST-OPENING-2026-01-01')

// Ao fazer softDelete em financial_ledger_entries, excluir pernas com business_event_id
// que apontam para o evento de abertura preservado.
```

---

## Verificação

```bash
# 1. Chamar migração via API
curl -X POST /api/invest/reconcile/migrate-opening-balance \
  -H "Authorization: Bearer TOKEN"
# Esperado: { success: true, report: { legsCreated: N, zeroed: N, blocked: [] } }

# 2. Verificar que opening_balance está zerado em todas as contas
# SELECT id, opening_balance FROM financial_accounts WHERE source_module = 'INVEST'
# Esperado: todos com opening_balance = 0

# 3. Verificar que pernas de abertura existem
# SELECT * FROM financial_ledger_entries WHERE external_ref LIKE 'OPENING-CASH-%'
# Esperado: uma por conta

# 4. Saldo antes e depois deve ser igual
# (calcular manualmente antes de rodar migração, comparar depois)

npm run build
npm test
```

---

## Definition of Done

- [ ] `OpeningBalanceMigrationService` criado e idempotente (rodar 2x = mesmo resultado)
- [ ] `CashBalanceService` separando `settledCash` / `inTransit` / `cashWithTransit`
- [ ] `PatrimonyMtmDailyEngine` não soma trânsito duas vezes
- [ ] Endpoint `POST /invest/reconcile/migrate-opening-balance` funcionando
- [ ] `HoldingPurgeKeepOpeningService` preserva evento `INVEST-OPENING-2026-01-01`
- [ ] `npm run build` sem erros
- [ ] `npm test` sem regressões
