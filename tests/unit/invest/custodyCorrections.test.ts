import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';
import { BTG_EXTRACT_2026_05_18_19 } from '../../../src/core/invest/btgExtractMay182026';
import { normalizeTesouroLedgerQuantity } from '../../../src/core/invest/tesouroDirectLedger';
describe('extrato LFT → custódia', () => {
  it('aplica vendas do extrato em R$ sem posição negativa', () => {
    const pu = 18774.21;
    const entries = [
      {
        asset_id: 'td1',
        asset_ticker: 'TESOURO-SELIC-2031',
        asset_type: 'fixed_income',
        transaction_type: 'opening_balance',
        quantity: 58,
        unit_price: pu,
        total_net_value: -58 * pu,
        impacts_managerial_price: true,
        transaction_date: '2026-01-01',
      },
    ];

    for (const line of BTG_EXTRACT_2026_05_18_19) {
      if (line.ticker !== 'TESOURO-SELIC-2031' || line.operation !== 'sell') continue;
      const norm = normalizeTesouroLedgerQuantity({
        quantity: line.quantity,
        unit_price: line.unit_price,
        total_net_value: line.total_net_value,
        date: line.date,
      });
      entries.push({
        asset_id: 'td1',
        asset_ticker: 'TESOURO-SELIC-2031',
        asset_type: 'fixed_income',
        transaction_type: 'sell',
        quantity: -norm.quantity,
        unit_price: norm.unit_price,
        total_net_value: line.total_net_value!,
        impacts_managerial_price: true,
        transaction_date: line.date,
      });
    }

    const { assets } = rebuildCustodyFromLedger(entries);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.quantity).toBeGreaterThan(0);
    expect(assets[0]!.quantity).toBeLessThan(58);
  });
});
