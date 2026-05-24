import { describe, expect, it } from '@jest/globals';
import { migrationsDir } from '../../../src/core/db/sqlMigrationRunner';
import fs from 'fs';
import path from 'path';

describe('ensureCoreSchema migrations', () => {
  it('encontra migrations 22 e 25 no repo', () => {
    const dir = migrationsDir();
    expect(fs.existsSync(path.join(dir, '22_market_quotes_global.sql'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '25_platform_job_monitoring.sql'))).toBe(true);
  });
});
