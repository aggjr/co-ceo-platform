import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, SecurePayload, UserContext } from '../dal';
import { BusinessEventRegistry } from '../business-events';
import { InvestBookPeriodService } from './InvestBookPeriodService';

const MONEY_TOL = 0.01;

export type OpeningMigrationReport = {
  accountsProcessed: number;
  legsCreated: number;
  legsAlreadyExisted: number;
  zeroed: number;
  blocked: { accountId: string; reason: string }[];
};

type FinancialAccountOpeningRow = {
  id: string;
  opening_balance?: number | string | null;
  opening_date?: string | Date | null;
};

type FinancialOpeningLegRow = {
  id: string;
  transaction_date?: string | Date | null;
  direction?: 'in' | 'out' | string | null;
  amount?: number | string | null;
  external_ref?: string | null;
  metadata?: unknown;
};

function toIsoDate(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class OpeningBalanceMigrationService {
  private readonly events: BusinessEventRegistry;
  private readonly periods: InvestBookPeriodService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.events = new BusinessEventRegistry(gateway);
    this.periods = new InvestBookPeriodService(gateway);
  }

  async migrate(ctx: UserContext): Promise<OpeningMigrationReport> {
    const report: OpeningMigrationReport = {
      accountsProcessed: 0,
      legsCreated: 0,
      legsAlreadyExisted: 0,
      zeroed: 0,
      blocked: [],
    };

    const period = await this.periods.resolveDefault(ctx);
    const { event } = await this.events.ensureByRef(ctx, {
      sourceModule: 'INVEST',
      eventKind: 'opening_balance',
      occurredOn: period.openingDate,
      settlesOn: period.openingDate,
      sourceRef: period.openingSourceRef,
      counterparty: 'Saldo inicial',
      totalNet: 0,
      sourceSystem: 'opening_balance_migration',
      metadata: {
        kind: 'trusted_opening_snapshot',
        description: `Abertura confiavel INVEST ${period.openingDate}`,
        book_period_source: period.source,
        opening_source_refs: period.openingSourceRefs,
      },
    });

    const accounts = (await this.gateway.findWhere(ctx, 'financial_accounts', {
      source_module: 'INVEST',
    })) as FinancialAccountOpeningRow[];

    for (const account of accounts) {
      report.accountsProcessed += 1;
      try {
        await this.migrateAccount(ctx, {
          accountId: String(account.id),
          openingBalance: Number(account.opening_balance ?? 0),
          openingDate: toIsoDate(account.opening_date, period.openingDate),
          openingEventId: event.id,
          report,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        report.blocked.push({ accountId: String(account.id), reason });
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
    const existingLeg = await this.findExistingOpeningLeg(
      ctx,
      accountId,
      openingDate,
      openingEventId
    );

    if (existingLeg) {
      const direction = String(existingLeg.direction ?? 'in');
      const legAmount = Number(existingLeg.amount ?? 0) * (direction === 'out' ? -1 : 1);
      const delta = Math.abs(legAmount - openingBalance);
      if (Math.abs(openingBalance) >= MONEY_TOL && delta > MONEY_TOL) {
        throw new Error(
          `Perna de abertura divergente: ledger=${legAmount}, opening_balance=${openingBalance}, delta=${delta}`
        );
      }
      if (Math.abs(openingBalance) >= MONEY_TOL) {
        await this.zeroAccountOpeningBalance(ctx, accountId, report);
      }
      report.legsAlreadyExisted += 1;
      return;
    }

    if (Math.abs(openingBalance) < MONEY_TOL) return;

    const payload: SecurePayload = {
      id: randomUUID(),
      account_id: accountId,
      business_event_id: openingEventId,
      transaction_date: openingDate,
      settlement_date: openingDate,
      direction: openingBalance >= 0 ? 'in' : 'out',
      amount: Math.abs(openingBalance),
      currency: 'BRL',
      description: 'Saldo inicial',
      status: 'cleared',
      external_ref: `OPENING-CASH-${accountId}-${openingDate}`,
      metadata: JSON.stringify({
        legacy_op: 'opening_balance',
        migrated_from: 'financial_accounts.opening_balance',
        original_value: openingBalance,
      }),
    };
    await this.gateway.insert(ctx, 'financial_ledger_entries', payload);
    await this.zeroAccountOpeningBalance(ctx, accountId, report);
    report.legsCreated += 1;
  }

  private async findExistingOpeningLeg(
    ctx: UserContext,
    accountId: string,
    openingDate: string,
    openingEventId: string
  ): Promise<FinancialOpeningLegRow | null> {
    const rows = (await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      {
        account_id: accountId,
        business_event_id: openingEventId,
      },
      { limit: 100 }
    )) as FinancialOpeningLegRow[];

    return (
      rows.find((row) => {
        const date = toIsoDate(row.transaction_date, '');
        const metadata = parseMetadata(row.metadata);
        return (
          date === openingDate &&
          (metadata.legacy_op === 'opening_balance' ||
            String(row.external_ref ?? '').startsWith('OPENING-CASH-'))
        );
      }) ?? null
    );
  }

  private async zeroAccountOpeningBalance(
    ctx: UserContext,
    accountId: string,
    report: OpeningMigrationReport
  ): Promise<void> {
    await this.gateway.update(ctx, 'financial_accounts', accountId, {
      opening_balance: 0,
    });
    report.zeroed += 1;
  }
}
