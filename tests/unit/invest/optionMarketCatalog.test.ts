import { loadOptionMarketCatalog } from '../../../src/core/invest/optionMarketCatalog';
import type { CoCeoDataGateway } from '../../../src/core/dal';

describe('loadOptionMarketCatalog', () => {
  it('carrega strikes via readQuery invest_options_market_for_org', async () => {
    const gateway = {
      readQuery: jest.fn().mockResolvedValue([
        {
          ticker: 'PRIOF760',
          underlying_ticker: 'PRIO3',
          option_type: 'CALL',
          strike_price: 76,
          expiration_date: '2026-06-19',
        },
      ]),
    } as unknown as CoCeoDataGateway;

    const map = await loadOptionMarketCatalog(gateway, 'org-holding-001');
    expect(gateway.readQuery).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global' }),
      'invest_options_market_for_org',
      ['org-holding-001']
    );
    expect(map.get('PRIOF760')?.strikePrice).toBe(76);
  });

  it('retorna mapa vazio quando consulta falha', async () => {
    const gateway = {
      readQuery: jest.fn().mockRejectedValue(new Error('no table')),
    } as unknown as CoCeoDataGateway;
    const map = await loadOptionMarketCatalog(gateway, 'org-holding-001');
    expect(map.size).toBe(0);
  });
});
