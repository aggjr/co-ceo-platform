/**
 * @tags parity user-expectation invest opcoes.net
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  b3OptionTickerFromOpcoesNetSuffix,
  parseOpcoesNetExpirations,
} from '../../src/core/invest/opcoesNetChainParser';
import { enrichPortfolioRow } from '../../src/core/invest/portfolioMapper';
import type { OpcoesNetExpiration } from '../../src/core/invest/opcoesNetClient';

const fixturePath = path.join(
  __dirname,
  '../fixtures/opcoes-net-prio3-expiration.json'
);

describe('@parity @user-expectation catálogo opcoes.net', () => {
  it('sufixo R407 + PRIO3 vira ticker B3 PRIOR407', () => {
    expect(b3OptionTickerFromOpcoesNetSuffix('PRIO3', 'R407')).toBe('PRIOR407');
  });

  it('fixture PRIO3: strike 40,75 e vencimento batem com PRIOR407', () => {
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as OpcoesNetExpiration;
    const rows = parseOpcoesNetExpirations('PRIO3', [raw], '2026-01-01');
    const put = rows.find((r) => r.ticker === 'PRIOR407' && r.optionType === 'PUT');
    expect(put).toBeDefined();
    expect(put!.strikePrice).toBe(40.75);
    expect(put!.expirationDate).toBe('2026-06-19');
    expect(put!.underlyingTicker).toBe('PRIO3');
  });

  it('opção na carteira: strike do catálogo prevalece sobre metadata desatualizado', () => {
    const marketCatalog = new Map([
      [
        'PRIOR407',
        {
          ticker: 'PRIOR407',
          underlyingTicker: 'PRIO3',
          optionType: 'PUT' as const,
          strikePrice: 40.75,
          expirationDate: '2026-06-19',
        },
      ],
    ]);
    const opt = enrichPortfolioRow(
      {
        id: 'o-parity',
        asset_ticker: 'PRIOR407',
        asset_type: 'option_put',
        current_quantity: -100,
        managerial_avg_price: 1,
        metadata: { option_strike: 40.7 },
        status: 'active',
      },
      undefined,
      { ledgerStrikeByTicker: new Map(), marketCatalog }
    );
    expect(opt.optionStrike).toBe(40.75);
    expect(opt.optionStrikeSource).toBe('market_catalog');
  });
});
