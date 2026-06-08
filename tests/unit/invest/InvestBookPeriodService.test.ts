import type { UserContext } from '../../../src/core/dal';
import { InvestBookPeriodService } from '../../../src/core/invest/InvestBookPeriodService';
import {
  InMemoryGateway,
  castGateway,
} from '../core/business-events/inMemoryGateway';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-book-001',
  impersonatorId: null,
  scope: 'node',
};

describe('InvestBookPeriodService', () => {
  it('resolve abertura default pelo catalogo da organizacao', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'invest_book_periods', {
      id: 'book-2025',
      book_code: 'INVEST',
      opening_date: '2025-07-01',
      opening_source_ref: 'OPENING:2025-07-01',
      fiscal_year: 2025,
      status: 'active',
      is_default: 1,
    });

    const period = await new InvestBookPeriodService(gateway).resolveDefault(ctx);

    expect(period.openingDate).toBe('2025-07-01');
    expect(period.openingSourceRef).toBe('OPENING:2025-07-01');
    expect(period.openingSourceRefs).toEqual([
      'OPENING:2025-07-01',
      'INVEST-OPENING-2025-07-01',
    ]);
    expect(period.source).toBe('catalog');
  });

  it('infere abertura por financial_accounts quando catalogo ainda nao existe', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'financial_accounts', {
      id: 'acc-1',
      source_module: 'INVEST',
      account_type: 'brokerage',
      external_id: 'BTG',
      name: 'Caixa BTG',
      opening_balance: 10,
      opening_date: '2024-03-15',
      status: 'active',
    });

    const period = await new InvestBookPeriodService(gateway).resolveDefault(ctx);

    expect(period.openingDate).toBe('2024-03-15');
    expect(period.openingSourceRef).toBe('OPENING:2024-03-15');
    expect(period.source).toBe('financial_accounts');
  });

  it('falha quando nao ha abertura configurada nem inferivel', async () => {
    const gateway = castGateway(new InMemoryGateway());

    await expect(new InvestBookPeriodService(gateway).resolveDefault(ctx)).rejects.toMatchObject({
      code: 'INVEST_BOOK_PERIOD_NOT_FOUND',
    });
  });
});
