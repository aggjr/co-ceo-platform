/**
 * Reconstroi todos os snapshots de patrimony_items relendo o livro razao.
 * Necessario apos mudancas na logica de valuation para que os campos
 * quantity/acquisition_value/current_value reflitam o calculo correto.
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD = "..."
 *   $env:REMOTE_DB_HOST = "69.62.99.34"
 *   node scripts/rebuild-all-snapshots.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: 'root',
    password: process.env.REMOTE_DB_PASSWORD,
    database: 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  // Busca todos os items da org
  const [items] = await conn.query(
    `SELECT pi.id, pi.identifier, pi.subcategory, pi.quantity, pi.acquisition_value
       FROM patrimony_items pi
      WHERE pi.organization_id = ?
        AND pi.deleted_at IS NULL
      ORDER BY pi.identifier`,
    [ORG_ID]
  );

  console.log(`Reconstruindo ${items.length} items...\n`);

  for (const item of items) {
    // Busca todas as pernas em ordem cronologica
    const [legs] = await conn.query(
      `SELECT movement_type, quantity_delta, unit_value, total_value,
              impacts_valuation, metadata, transaction_date
         FROM patrimony_ledger_entries
        WHERE patrimony_item_id = ?
          AND deleted_at IS NULL
        ORDER BY transaction_date ASC, created_at ASC`,
      [item.id]
    );

    // Busca o metodo de valuation via module_categories
    const [cats] = await conn.query(
      `SELECT default_valuation_method
         FROM module_categories
        WHERE module_code = 'INVEST'
          AND category = 'financial_asset'
          AND subcategory = ?`,
      [item.subcategory]
    );
    const method = cats[0]?.default_valuation_method || 'three_prices_invest';

    // Simula o calculo de estado
    let state = { quantity: 0, acquisitionValue: 0 };
    for (const leg of legs) {
      if (!leg.impacts_valuation) continue;
      const qty = Number(leg.quantity_delta);
      const pu = Number(leg.unit_value);
      const meta = leg.metadata ? (typeof leg.metadata === 'string' ? JSON.parse(leg.metadata) : leg.metadata) : {};

      if (leg.movement_type === 'opening_balance') {
        const cost = qty * pu;
        state.quantity += qty;
        state.acquisitionValue += cost;
      } else if (leg.movement_type === 'acquisition') {
        const cost = qty * pu;
        state.quantity += qty;
        state.acquisitionValue += cost;
      } else if (leg.movement_type === 'disposition') {
        state.quantity += qty; // qty negativo
        // Mantém PM — reduz proportionalmente
        if (state.quantity <= 0) {
          state.quantity = 0;
          state.acquisitionValue = 0;
        } else {
          state.acquisitionValue = state.quantity * (state.acquisitionValue / (state.quantity - qty));
        }
      } else if (leg.movement_type === 'short_open') {
        const cost = qty * pu; // negativo
        state.quantity += qty;
        state.acquisitionValue += cost;
      } else if (leg.movement_type === 'short_close') {
        state.quantity += qty; // positivo (fecha a short)
        if (state.quantity >= 0) {
          state.quantity = 0;
          state.acquisitionValue = 0;
        } else {
          // Ainda tem posicao short — recalcula
          const pmA = state.acquisitionValue !== 0 ? Math.abs(state.acquisitionValue / (state.quantity - qty)) : 0;
          state.acquisitionValue = state.quantity * pmA;
        }
      } else if (leg.movement_type === 'cost_adjustment') {
        state.acquisitionValue += pu; // custo absoluto positivo
      } else if (leg.movement_type === 'revaluation') {
        // noop para acquisitionValue
      }
    }

    const newStatus = state.quantity === 0 ? 'liquidated' : 'active';
    const [prev] = await conn.query(
      `SELECT quantity, acquisition_value, status FROM patrimony_items WHERE id = ?`,
      [item.id]
    );
    const prevQty = Number(prev[0]?.quantity);
    const prevAcq = Number(prev[0]?.acquisition_value);

    const qtyChanged = Math.abs(prevQty - state.quantity) > 0.0001;
    const acqChanged = Math.abs(prevAcq - state.acquisitionValue) > 0.01;
    const statusChanged = prev[0]?.status !== newStatus;

    if (qtyChanged || acqChanged || statusChanged) {
      await conn.query(
        `UPDATE patrimony_items SET quantity = ?, acquisition_value = ?, current_value = ?, status = ?, updated_at = NOW()
           WHERE id = ?`,
        [state.quantity, state.acquisitionValue, state.acquisitionValue, newStatus, item.id]
      );
      console.log(`  UPDATED ${item.identifier.padEnd(20)} qty=${state.quantity.toFixed(2)} acq=${state.acquisitionValue.toFixed(4)} status=${newStatus}`);
    } else {
      console.log(`  OK      ${item.identifier.padEnd(20)} qty=${state.quantity.toFixed(2)} acq=${state.acquisitionValue.toFixed(4)}`);
    }
  }

  await conn.end();
  console.log('\nReconstrucao concluida.');
}

main().catch(e => { console.error(e); process.exit(1); });
