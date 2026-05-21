/**
 * Conserta lançamentos do livro razão onde unit_price ficou contaminado pelo
 * managerial_avg_price corrompido do snapshot. Para cada exercício:
 *   - reescreve unit_price = strike real
 *   - reescreve quantity  = |total_net_value| / strike (com sinal certo)
 * E deleta lançamentos sintéticos `BTG-SNAPSHOT-STOCK-SYNC:*`.
 *
 * Strikes vêm de uma tabela neste script (foco diagnóstico, dados reais do
 * usuário). Tabela canônica futura: campo option_strike no livro razão.
 *
 * Uso: npx ts-node scripts/fix-corrupted-exercise-prices.ts
 *      (dry-run por padrão; passe --apply para gravar)
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const APPLY = process.argv.includes('--apply');

/** broker_note_ref termina em #<TICKER_OPCAO> → strike real (R$). */
const STRIKES_BY_OPTION_TICKER: Record<string, number> = {
  // ITUB4 (tabela enviada por Augusto)
  ITUBQ413: 41.43, // ITUBQ413E e ITUBQ413F — mesma série
  ITUBQ445: 40.72,
  ITUBQ434: 39.75,
  ITUBQ42: 41.93,
  ITUBQ425: 42.43,
  ITUBQ415: 40.93,
  ITUBQ1: 42.93,
  ITUBQ436: 39.99,
};

function stripExerciseSuffix(s: string): string {
  return s.trim().toUpperCase().replace(/[EF]$/, '');
}

function extractOptionTickerFromRef(ref: string | null): string | null {
  if (!ref) return null;
  // Formato: BTG-EXERCISE-2026-05-15#15#ITUBQ1F
  const parts = ref.split('#');
  if (parts.length < 3) return null;
  return stripExerciseSuffix(parts[parts.length - 1]);
}

function fmtBrl(n: number): string {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main(): Promise<void> {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  console.log(`Modo: ${APPLY ? 'APPLY (vai gravar)' : 'DRY-RUN (não grava nada)'}`);

  // 1. Lançamentos contaminados de exercício BTG.
  const [exerciseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT e.id, e.transaction_type, e.quantity, e.unit_price, e.total_net_value,
            e.broker_note_ref, a.asset_ticker, a.asset_type
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ?
       AND e.deleted_at IS NULL
       AND e.broker_note_ref LIKE 'BTG-EXERCISE-%'`,
    [ORG]
  );

  console.log(`\n=== Lançamentos de exercício a corrigir: ${exerciseRows.length} ===`);
  let fixed = 0;
  let skipped = 0;
  for (const r of exerciseRows) {
    const ref = r.broker_note_ref ? String(r.broker_note_ref) : null;
    const optionTicker = extractOptionTickerFromRef(ref);
    if (!optionTicker) {
      console.log(`  ⚠ sem ticker no ref: ${ref}`);
      skipped++;
      continue;
    }
    const strike = STRIKES_BY_OPTION_TICKER[optionTicker];
    if (!strike) {
      console.log(`  ⚠ sem strike para ${optionTicker} no dicionário (pulando)`);
      skipped++;
      continue;
    }
    const net = Number(r.total_net_value);
    if (!Number.isFinite(net) || net === 0) {
      console.log(`  ⚠ net inválido em ${r.id}: ${net}`);
      skipped++;
      continue;
    }

    const absQty = Math.abs(net) / strike;
    const qtyRounded = Math.round(absQty); // ações são inteiras
    const txType = String(r.transaction_type);
    const sign = ['sell', 'put_sell', 'call_sell'].includes(txType) ? -1 : 1;
    const newQty = sign * qtyRounded;

    const oldQty = Number(r.quantity);
    const oldUnitPrice = Number(r.unit_price);
    console.log(
      `  ${r.asset_ticker.padEnd(8)} ${txType.padEnd(20)} ${optionTicker.padEnd(10)} ` +
        `qty ${oldQty} → ${newQty}  unit_price ${fmtBrl(oldUnitPrice)} → ${fmtBrl(strike)}  ` +
        `(net=${fmtBrl(net)}, qty_calc=${absQty.toFixed(4)})`
    );

    if (APPLY) {
      await pool.query(
        `UPDATE invest_ledger_entries
         SET quantity = ?, unit_price = ?
         WHERE id = ?`,
        [newQty, strike, r.id]
      );
    }
    fixed++;
  }
  console.log(`Corrigidos: ${fixed} · Pulados: ${skipped}`);

  // 2. Deletar lançamentos sintéticos BTG-SNAPSHOT-STOCK-SYNC (compensações erradas).
  const [snapSyncRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT e.id, e.quantity, e.unit_price, e.total_net_value, e.broker_note_ref, a.asset_ticker
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ?
       AND e.deleted_at IS NULL
       AND e.broker_note_ref LIKE 'BTG-SNAPSHOT-STOCK-SYNC%'`,
    [ORG]
  );
  console.log(`\n=== Lançamentos BTG-SNAPSHOT-STOCK-SYNC a deletar: ${snapSyncRows.length} ===`);
  for (const r of snapSyncRows) {
    console.log(
      `  ${r.asset_ticker.padEnd(8)} qty=${r.quantity} unit_price=${fmtBrl(Number(r.unit_price))} ` +
        `net=${fmtBrl(Number(r.total_net_value))} (${r.broker_note_ref})`
    );
    if (APPLY) {
      await pool.query(
        `UPDATE invest_ledger_entries SET deleted_at = NOW() WHERE id = ?`,
        [r.id]
      );
    }
  }

  // 3. Zerar managerial_avg_price do snapshot — view materializada deve ser
  //    re-derivada do livro. Não tocamos em current_quantity aqui; deixar a
  //    próxima execução do listPortfolio sobrescrever via mergeLedgerCustody.
  const tickersAfetados = ['ITUB4', 'WEGE3', 'BBAS3'];
  console.log(`\n=== Snapshot a resetar (managerial_avg_price → 0): ${tickersAfetados.join(', ')} ===`);
  for (const tk of tickersAfetados) {
    if (APPLY) {
      await pool.query(
        `UPDATE invest_assets
         SET managerial_avg_price = 0, current_quantity = 0
         WHERE organization_id = ? AND asset_ticker = ?`,
        [ORG, tk]
      );
    }
    console.log(`  ${tk} → reset (managerial_avg_price=0, current_quantity=0)`);
  }

  if (!APPLY) {
    console.log(`\n(dry-run — rode novamente com --apply para gravar)`);
  } else {
    console.log(`\n✓ Aplicado.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
