import type { CoCeoDataGateway, UserContext } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';
import { addBusinessDays, addCalendarDays, type SettlementCalendarUnit } from './settlementCalendar';

export type ResolvedSettlementRule = {
  ruleCode: string;
  contractTypeCode: string;
  daysOffset: number;
  calendarUnit: SettlementCalendarUnit;
  businessCalendarCode: string | null;
  defaultStatus: 'pending' | 'cleared';
  label: string;
};

function tickerMatchesPrefix(rowPrefix: unknown, ticker: string): boolean {
  const prefix = String(rowPrefix ?? '').trim().toUpperCase();
  if (!prefix) return true;
  return ticker.toUpperCase().startsWith(prefix);
}

function specificity(row: Record<string, unknown>): number {
  let score = 0;
  if (String(row.asset_type ?? '') !== '*') score += 10;
  if (String(row.transaction_type ?? '') !== '*') score += 10;
  if (row.ticker_prefix) score += 20;
  return score;
}

function rowToRule(row: Record<string, unknown>): ResolvedSettlementRule {
  return {
    ruleCode: String(row.rule_code),
    contractTypeCode: String(row.contract_type_code),
    daysOffset: Number(row.days_offset ?? 0),
    calendarUnit: String(row.calendar_unit ?? 'business_days') as SettlementCalendarUnit,
    businessCalendarCode: row.business_calendar_code ? String(row.business_calendar_code) : null,
    defaultStatus: String(row.default_status ?? 'pending') as 'pending' | 'cleared',
    label: String(row.label ?? ''),
  };
}

export class SettlementRulesService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async resolveRule(
    input: {
      tradeDate: string;
      assetType: string;
      transactionType: string;
      ticker?: string;
    },
    ctx: UserContext = authBootstrapContext()
  ): Promise<ResolvedSettlementRule | null> {
    const day = input.tradeDate.slice(0, 10);
    const assetType = String(input.assetType || '').trim().toLowerCase();
    const transactionType = String(input.transactionType || '').trim().toLowerCase();
    const ticker = String(input.ticker || '').trim().toUpperCase();
    if (!day || !assetType || !transactionType) return null;

    const rows = await this.gateway.readQuery(ctx, 'settlement_rule_candidates', [
      assetType,
      transactionType,
      day,
      day,
    ]);
    const matches = rows
      .filter((row) => tickerMatchesPrefix(row.ticker_prefix, ticker))
      .sort((a, b) => specificity(b) - specificity(a) || Number(a.priority ?? 100) - Number(b.priority ?? 100));
    return matches[0] ? rowToRule(matches[0]) : null;
  }

  async resolveSettlementDate(
    input: {
      tradeDate: string;
      assetType: string;
      transactionType: string;
      ticker?: string;
    },
    ctx?: UserContext
  ): Promise<string> {
    const day = input.tradeDate.slice(0, 10);
    const rule = await this.resolveRule(input, ctx);
    if (!rule || rule.daysOffset <= 0) return day;
    return rule.calendarUnit === 'calendar_days'
      ? addCalendarDays(day, rule.daysOffset)
      : addBusinessDays(day, rule.daysOffset);
  }

  async defersCashSettlement(
    input: {
      tradeDate: string;
      assetType: string;
      transactionType: string;
      ticker?: string;
    },
    ctx?: UserContext
  ): Promise<boolean> {
    const rule = await this.resolveRule(input, ctx);
    return Boolean(rule && rule.daysOffset > 0);
  }
}
