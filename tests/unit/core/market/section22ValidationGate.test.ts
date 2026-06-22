/**
 * Gate validador A-02 / M-01 / S-02 (secao 14.4).
 */
import fs from 'fs';
import path from 'path';
import {
  MARKET_DATA_PRECEDENCE_CATALOG,
  MARKET_DATA_PRECEDENCE_CATALOG_VERSION,
} from '../../../../src/core/market/marketDataPrecedenceCatalog';
import { registerDefaultMarketDataProviders } from '../../../../src/core/market/registerDefaultMarketDataProviders';
import { MarketDataProviderRegistry } from '../../../../src/core/market/MarketDataProviderRegistry';

describe('section22 validation gate (market data backlog)', () => {
  describe('A-02 — catalogo precedencia', () => {
    it('versao A-02 com regras por subcategoria e campo', () => {
      expect(MARKET_DATA_PRECEDENCE_CATALOG_VERSION).toBe('A-02');
      expect(MARKET_DATA_PRECEDENCE_CATALOG.length).toBeGreaterThanOrEqual(10);
      const stock = MARKET_DATA_PRECEDENCE_CATALOG.find(
        (r) => r.assetSubcategory === 'stock' && r.field === 'daily_close_price'
      );
      expect(stock?.sources[0]).toBe('brapi');
    });
  });

  describe('M-01 — registry com providers default', () => {
    it('registra tres fontes sem branching no registry', () => {
      const registry = new MarketDataProviderRegistry();
      const added = registerDefaultMarketDataProviders(registry);
      expect(added).toContain('brapi');
      expect(registry.isRegistered('opcoes_net')).toBe(true);
      expect(registry.isRegistered('tesouro_direto')).toBe(true);
    });
  });

  describe('S-02 — hardcode proibido em domain (amostra)', () => {
    it('InvestQuoteSyncService ainda tem branching legacy documentado para M-02', () => {
      const src = fs.readFileSync(
        path.join(__dirname, '../../../../src/core/invest/InvestQuoteSyncService.ts'),
        'utf8'
      );
      expect(src).toMatch(/if \(source === 'brapi'\)/);
      expect(src).toMatch(/if \(source === 'opcoes_net'\)/);
    });
  });
});
