import { LedgerEventProjection } from '../../../../src/modules/invest/sync/LedgerEventProjection';
import { SYSTEM_INSTALLER_USER_ID } from '../../../../src/core/dal/types';
import type { UserContext } from '../../../../src/core/dal';

type Row = Record<string, unknown>;

class FakeGateway {
  constructor(
    private readonly tables: {
      patrimony_items: Row[];
      invest_position_ext: Row[];
      financial_accounts: Row[];
      patrimony_ledger_entries: Row[];
      financial_ledger_entries: Row[];
    }
  ) {}

  async findWhere(_ctx: UserContext, table: keyof FakeGateway['tables'], where: Row): Promise<Row[]> {
    const rows = this.tables[table] || [];
    return rows.filter((r) =>
      Object.entries(where).every(([k, v]) => v === undefined || r[k] === v)
    );
  }
}

const ORG = 'org-test';
const ctx: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: ORG,
  impersonatorId: null,
  scope: 'global',
};

function makeGateway(opts: Partial<ConstructorParameters<typeof FakeGateway>[0]> = {}) {
  return new FakeGateway({
    patrimony_items: [],
    invest_position_ext: [],
    financial_accounts: [],
    patrimony_ledger_entries: [],
    financial_ledger_entries: [],
    ...opts,
  }) as unknown as ConstructorParameters<typeof LedgerEventProjection>[0];
}

describe('LedgerEventProjection', () => {
  it('projeta opening_balance de stock com convencao legada (qty abs, net = qty*price)', async () => {
    const gw = makeGateway({
      patrimony_items: [
        {
          id: 'item-prio3',
          organization_id: ORG,
          source_module: 'INVEST',
          subcategory: 'stock',
          identifier: 'PRIO3',
        },
      ],
      invest_position_ext: [
        {
          patrimony_item_id: 'item-prio3',
          organization_id: ORG,
          asset_class: 'stock',
          underlying_ticker: null,
        },
      ],
      patrimony_ledger_entries: [
        {
          id: 'led-1',
          organization_id: ORG,
          patrimony_item_id: 'item-prio3',
          transaction_date: '2026-01-01',
          movement_type: 'opening_balance',
          quantity_delta: 5400,
          unit_value: 38.33,
          total_value: 206982,
          impacts_valuation: true,
          external_ref: null,
          notes: 'Saldo inicial',
          metadata: null,
        },
      ],
    });
    const proj = new LedgerEventProjection(gw);
    const events = await proj.listLedgerEvents(ctx, '2020-01-01', '2030-12-31');
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.asset_ticker).toBe('PRIO3');
    expect(e.asset_type).toBe('stock');
    expect(e.transaction_type).toBe('opening_balance');
    expect(e.quantity).toBe(5400);
    expect(e.unit_price).toBe(38.33);
    expect(e.total_net_value).toBeCloseTo(5400 * 38.33, 4);
  });

  it('projeta opening_balance de PUT vendida (quantity_delta negativo) com qty abs e net signed', async () => {
    const gw = makeGateway({
      patrimony_items: [
        {
          id: 'item-q43',
          organization_id: ORG,
          source_module: 'INVEST',
          subcategory: 'option_put',
          identifier: 'PRIOQ43',
        },
      ],
      invest_position_ext: [
        {
          patrimony_item_id: 'item-q43',
          organization_id: ORG,
          asset_class: 'option_put',
          underlying_ticker: 'PRIO3',
        },
      ],
      patrimony_ledger_entries: [
        {
          id: 'led-2',
          organization_id: ORG,
          patrimony_item_id: 'item-q43',
          transaction_date: '2026-01-01',
          movement_type: 'opening_balance',
          quantity_delta: -31200,
          unit_value: 1.426748,
          total_value: 44514.54,
          impacts_valuation: true,
          metadata: null,
        },
      ],
    });
    const proj = new LedgerEventProjection(gw);
    const events = await proj.listLedgerEvents(ctx, '2020-01-01', '2030-12-31');
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.asset_ticker).toBe('PRIOQ43');
    expect(e.asset_type).toBe('option_put');
    expect(e.underlying_ticker).toBe('PRIO3');
    expect(e.transaction_type).toBe('opening_balance');
    expect(e.quantity).toBe(31200);
    expect(e.total_net_value).toBeCloseTo(-31200 * 1.426748, 3);
  });

  it('respeita metadata.legacy_op para reconstruir transaction_type fielmente', async () => {
    const gw = makeGateway({
      patrimony_items: [
        {
          id: 'item-a',
          organization_id: ORG,
          source_module: 'INVEST',
          subcategory: 'stock',
          identifier: 'ACAO3',
        },
      ],
      invest_position_ext: [
        {
          patrimony_item_id: 'item-a',
          organization_id: ORG,
          asset_class: 'stock',
          underlying_ticker: null,
        },
      ],
      patrimony_ledger_entries: [
        {
          id: 'led-3',
          organization_id: ORG,
          patrimony_item_id: 'item-a',
          transaction_date: '2026-03-15',
          movement_type: 'acquisition',
          quantity_delta: 100,
          unit_value: 50,
          total_value: 5000,
          impacts_valuation: true,
          metadata: JSON.stringify({ legacy_op: 'option_exercise', broker_note_ref: 'BTG-EX-1' }),
        },
      ],
    });
    const proj = new LedgerEventProjection(gw);
    const events = await proj.listLedgerEvents(ctx, '2020-01-01', '2030-12-31');
    expect(events[0].transaction_type).toBe('option_exercise');
    expect(events[0].broker_note_ref).toBe('BTG-EX-1');
  });

  it('projeta financial_ledger_entry "Saldo inicial" como opening_balance do CAIXA-<external>', async () => {
    const gw = makeGateway({
      financial_accounts: [
        {
          id: 'acc-1',
          organization_id: ORG,
          source_module: 'INVEST',
          external_id: 'BTG',
        },
      ],
      financial_ledger_entries: [
        {
          id: 'fin-1',
          organization_id: ORG,
          account_id: 'acc-1',
          transaction_date: '2026-01-01',
          direction: 'in',
          amount: 58758.79,
          status: 'cleared',
          description: 'Saldo inicial',
          metadata: null,
        },
      ],
    });
    const proj = new LedgerEventProjection(gw);
    const events = await proj.listLedgerEvents(ctx, '2020-01-01', '2030-12-31');
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.asset_ticker).toBe('CAIXA-BTG');
    expect(e.asset_type).toBe('cash');
    expect(e.transaction_type).toBe('opening_balance');
    expect(e.total_net_value).toBeCloseTo(58758.79, 4);
  });

  it('financial_ledger pending vira transaction_type=pending_settlement', async () => {
    const gw = makeGateway({
      financial_accounts: [
        { id: 'acc-1', organization_id: ORG, source_module: 'INVEST', external_id: 'BTG' },
      ],
      financial_ledger_entries: [
        {
          id: 'fin-2',
          organization_id: ORG,
          account_id: 'acc-1',
          transaction_date: '2026-03-10',
          direction: 'out',
          amount: 1000,
          status: 'pending',
          description: 'Liquidacao D+2 PRIO3',
          metadata: null,
        },
      ],
    });
    const proj = new LedgerEventProjection(gw);
    const events = await proj.listLedgerEvents(ctx, '2020-01-01', '2030-12-31');
    expect(events[0].transaction_type).toBe('pending_settlement');
    expect(events[0].total_net_value).toBeCloseTo(-1000, 4);
  });

  it('cost_adjustment LFT projeta tipo e total_net_value pelo unit_value (nao qty*price)', async () => {
    const gw = makeGateway({
      patrimony_items: [
        {
          id: 'item-lft',
          organization_id: ORG,
          source_module: 'INVEST',
          subcategory: 'fixed_income',
          identifier: 'LFT-20310301',
        },
      ],
      invest_position_ext: [
        {
          patrimony_item_id: 'item-lft',
          organization_id: ORG,
          asset_class: 'fixed_income',
          underlying_ticker: null,
        },
      ],
      patrimony_ledger_entries: [
        {
          id: 'led-lft-adj',
          organization_id: ORG,
          patrimony_item_id: 'item-lft',
          transaction_date: '2026-04-22',
          movement_type: 'cost_adjustment',
          quantity_delta: 0,
          unit_value: 7618.65,
          total_value: 7618.65,
          impacts_valuation: true,
          metadata: JSON.stringify({
            legacy_op: 'fee',
            broker_note_ref: 'BTG-EXT-2026-04-22#02',
          }),
          notes: 'IRRF Tesouro Direto',
        },
      ],
    });
    const proj = new LedgerEventProjection(gw);
    const events = await proj.listLedgerEvents(ctx, '2026-01-01', '2026-12-31');
    expect(events.length).toBe(1);
    expect(events[0].transaction_type).toBe('cost_adjustment');
    expect(events[0].total_net_value).toBeCloseTo(7618.65, 2);
    expect(events[0].quantity).toBe(0);
  });

  it('janela de datas filtra eventos fora de [from, to]', async () => {
    const gw = makeGateway({
      patrimony_items: [
        { id: 'item-a', organization_id: ORG, source_module: 'INVEST', subcategory: 'stock', identifier: 'X' },
      ],
      invest_position_ext: [
        { patrimony_item_id: 'item-a', organization_id: ORG, asset_class: 'stock' },
      ],
      patrimony_ledger_entries: [
        { id: '1', organization_id: ORG, patrimony_item_id: 'item-a', transaction_date: '2025-12-31', movement_type: 'opening_balance', quantity_delta: 1, unit_value: 1, total_value: 1, impacts_valuation: true },
        { id: '2', organization_id: ORG, patrimony_item_id: 'item-a', transaction_date: '2026-06-15', movement_type: 'acquisition', quantity_delta: 1, unit_value: 1, total_value: 1, impacts_valuation: true },
        { id: '3', organization_id: ORG, patrimony_item_id: 'item-a', transaction_date: '2027-01-02', movement_type: 'disposition', quantity_delta: -1, unit_value: 1, total_value: 1, impacts_valuation: true },
      ],
    });
    const proj = new LedgerEventProjection(gw);
    const events = await proj.listLedgerEvents(ctx, '2026-01-01', '2026-12-31');
    expect(events.length).toBe(1);
    expect(events[0].id).toBe('2');
  });
});
