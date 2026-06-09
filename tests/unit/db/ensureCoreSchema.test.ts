import { describe, expect, it } from '@jest/globals';
import { migrationsDir } from '../../../src/core/db/sqlMigrationRunner';
import fs from 'fs';
import path from 'path';

describe('ensureCoreSchema migrations', () => {
  it('encontra migrations 22, 25, 39, 43, 44 e 46 no repo', () => {
    const dir = migrationsDir();
    expect(fs.existsSync(path.join(dir, '22_market_quotes_global.sql'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '25_platform_job_monitoring.sql'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '39_normalize_settlement_contracts.sql'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '43_invest_operation_policy_catalog.sql'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '44_invest_cash_account_policy.sql'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '46_invest_book_periods.sql'))).toBe(true);
  });

  it('regressao producao: catalogo de periodo contabil fica na migration 46, nao 45', () => {
    const dir = migrationsDir();
    expect(fs.existsSync(path.join(dir, '46_invest_book_periods.sql'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '45_invest_book_periods.sql'))).toBe(false);
  });
});
