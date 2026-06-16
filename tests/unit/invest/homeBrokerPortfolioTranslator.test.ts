import * as fs from 'fs';
import * as path from 'path';
import {
  isHomeBrokerPortfolioSnapshot,
  translateHomeBrokerPortfolioSnapshot,
} from '../../../src/core/invest/homeBrokerPortfolioTranslator';
import { parseBrokerCustodySnapshotJson } from '../../../src/core/invest/brokerCustodySnapshotImport';
import { inferAssetType } from '../../../src/core/invest/assetClassifier';

const fixturePath = path.join(__dirname, '../../fixtures/home-broker-carteira-atualizada.json');

describe('homeBrokerPortfolioTranslator', () => {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  it('reconhece o formato de carteira atualizada e nao confunde com snapshot canonico', () => {
    expect(isHomeBrokerPortfolioSnapshot(raw)).toBe(true);
    expect(isHomeBrokerPortfolioSnapshot({ schemaVersion: 1, composition: {}, positions: [] })).toBe(
      false
    );
    expect(isHomeBrokerPortfolioSnapshot({ mes: '2026-01', patrimonio_final: 10 })).toBe(false);
  });

  it('traduz para o schema canonico e passa pela validacao', () => {
    const canonical = translateHomeBrokerPortfolioSnapshot(raw);
    const snap = parseBrokerCustodySnapshotJson(canonical);

    expect(snap.referenceDate).toBe('2026-06-05');
    expect(snap.broker).toBe('btg');
    expect(snap.positions.length).toBe(4);
    expect(snap.positions.every((p) => p.lineKind === 'mark')).toBe(true);
  });

  it('mapeia composicao patrimonial do home broker', () => {
    const canonical = translateHomeBrokerPortfolioSnapshot(raw);
    expect(canonical.composition).toEqual({
      variableIncome: 1214004.19,
      fixedIncome: 209823.33,
      cash: 21193.1,
      inTransit: 775.75,
      derivatives: -14905.86,
      totalPatrimony: 1430890.51,
    });
  });

  it('preserva quantidade, preco e valor de mercado por posicao (acoes e opcoes)', () => {
    const canonical = translateHomeBrokerPortfolioSnapshot(raw);
    const byTicker = Object.fromEntries(canonical.positions.map((p) => [p.ticker, p]));

    expect(byTicker.PRIO3).toMatchObject({ quantity: 12700, lastPrice: 62.59, marketValue: 794893.0 });
    expect(byTicker.BBASG216).toMatchObject({ quantity: -6000, lastPrice: 0.28, marketValue: -1668.01 });

    // opcoes com lastPrice > 0 (exigencia do mark), e classificadas corretamente
    expect(inferAssetType('BBASG216')).toBe('option_call');
    expect(inferAssetType('PRIOQ69')).toBe('option_put');
    expect(canonical.positions.find((p) => p.ticker === 'PRIOQ69')!.lastPrice).toBeGreaterThan(0);
  });
});
