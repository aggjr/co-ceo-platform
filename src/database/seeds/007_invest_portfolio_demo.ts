/**
 * Carteira demo da holding — edite DEMO_POSITIONS ou passe PORTFOLIO_SEED_JSON no .env.
 * Uso: npm run seed:portfolio
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../../core/dal';
import { installerContext } from './lib/installerContext';
import { ensureInsert } from './lib/seedHelpers';

dotenv.config();

const HOLDING_ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

/** Posições iniciais para validação de UI (tabela × cards). */
export const DEMO_POSITIONS = [
  {
    id: 'ast-demo-prio3',
    asset_ticker: 'PRIO3',
    asset_type: 'stock',
    current_quantity: 1200,
    managerial_avg_price: 42.15,
    metadata: {
      name: 'PetroRio',
      sector: 'Petróleo e gás',
      last_price: 55.2,
    },
  },
  {
    id: 'ast-demo-petr4',
    asset_ticker: 'PETR4',
    asset_type: 'stock',
    current_quantity: 2500,
    managerial_avg_price: 28.9,
    metadata: {
      name: 'Petrobras PN',
      sector: 'Petróleo e gás',
      last_price: 38.45,
    },
  },
  {
    id: 'ast-demo-vale3',
    asset_ticker: 'VALE3',
    asset_type: 'stock',
    current_quantity: 800,
    managerial_avg_price: 62.1,
    metadata: {
      name: 'Vale',
      sector: 'Mineração',
      last_price: 58.3,
    },
  },
  {
    id: 'ast-demo-hglg11',
    asset_ticker: 'HGLG11',
    asset_type: 'fii',
    current_quantity: 450,
    managerial_avg_price: 158.2,
    metadata: {
      name: 'CSHG Logística',
      sector: 'FIIs — Logística',
      last_price: 162.8,
    },
  },
  {
    id: 'ast-demo-mxrf11',
    asset_ticker: 'MXRF11',
    asset_type: 'fii',
    current_quantity: 1800,
    managerial_avg_price: 10.15,
    metadata: {
      name: 'Maxi Renda',
      sector: 'FIIs — Papel',
      last_price: 10.42,
    },
  },
  {
    id: 'ast-demo-lca',
    asset_ticker: 'LCA-BTG-2027',
    asset_type: 'fixed_income',
    current_quantity: 1,
    managerial_avg_price: 250000,
    metadata: {
      name: 'LCA BTG 2027',
      sector: 'Renda fixa',
      last_price: 252400,
      notes: 'Valor unitário = posição total',
    },
  },
] as const;

function loadPositions(): typeof DEMO_POSITIONS {
  const raw = process.env.PORTFOLIO_SEED_JSON;
  if (!raw?.trim()) return DEMO_POSITIONS;
  const parsed = JSON.parse(raw) as typeof DEMO_POSITIONS;
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error('PORTFOLIO_SEED_JSON deve ser um array não vazio.');
  }
  return parsed;
}

async function runSeed() {
  const positions = loadPositions();
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = installerContext();

  console.log(`[007] Portfólio demo → org ${HOLDING_ORG_ID} (${positions.length} posições)...`);

  for (const pos of positions) {
    await ensureInsert(gateway, ctx, 'invest_assets', pos.id, {
      organization_id: HOLDING_ORG_ID,
      asset_ticker: pos.asset_ticker,
      asset_type: pos.asset_type,
      current_quantity: pos.current_quantity,
      managerial_avg_price: pos.managerial_avg_price,
      metadata: JSON.stringify(pos.metadata),
      status: 'active',
    });
  }

  console.log('✅ Portfólio demo inserido (ids estáveis — reexecutar é idempotente).');
  await pool.end();
}

runSeed().catch((err) => {
  console.error(err);
  process.exit(1);
});
