#!/usr/bin/env node
/**
 * Testes de paridade com brapi ao vivo (requer BRAPI_TOKEN).
 */
const { execSync } = require('child_process');
const path = require('path');

process.env.PARITY_LIVE_MARKET = '1';

const root = path.join(__dirname, '..');
execSync(
  'npx jest --selectProjects unit-core --testPathPattern=tests/parity --runInBand',
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  }
);
