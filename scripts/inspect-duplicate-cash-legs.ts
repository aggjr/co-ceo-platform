/**
 * Conferência caixa vs custódia para pares duplicados (mesma fingerprint).
 *
 *   npx ts-node scripts/inspect-duplicate-cash-legs.ts
 *   npx ts-node scripts/inspect-duplicate-cash-legs.ts BTG-NOTA-31582497#2026-04-27#8 BTG-NOTA-31582497#2026-04-27#9
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

const DEFAULT_REFS = [
  'BTG-NOTA-31582497#2026-04-27#8',
  'BTG-NOTA-31582497#2026-04-27#9',
  'BTG-NOTA-31609259#2026-04-28#4',
  'BTG-NOTA-31609259#2026-04-28#5',
];

async function main() {
  const refs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_REFS;
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina REMOTE_DB_PASSWORD ou DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  console.log(`Org: ${ORG}\n`);

  for (const ref of refs) {
    console.log('='.repeat(72));
    console.log(`REF: ${ref}`);
    console.log('-'.repeat(72));

    const [pat] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT ple.id, ple.transaction_date, ple.movement_type, ple.quantity_delta,
              ple.unit_value, ple.total_value, ple.external_ref, ple.notes, ple.metadata,
              pi.identifier, pi.subcategory
       FROM patrimony_ledger_entries ple
       JOIN patrimony_items pi ON pi.id = ple.patrimony_item_id
       WHERE ple.organization_id = ? AND ple.deleted_at IS NULL
         AND ple.external_ref = ?`,
      [ORG, `BROKER_REF:${ref}`]
    );

    if (!pat.length) {
      console.log('  Patrimônio: NENHUM lançamento com este external_ref');
    } else {
      for (const r of pat) {
        console.log(
          `  Patrimônio: ${r.id} | ${String(r.transaction_date).slice(0, 10)} | ${r.identifier} | ` +
            `${r.movement_type} qty=${r.quantity_delta} unit=${r.unit_value} total=${r.total_value}`
        );
      }
    }

    for (const ext of [`BROKER_REF:${ref}`, `BROKER_REF:${ref}:CASH`]) {
      const [fin] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT fle.id, fle.transaction_date, fle.direction, fle.amount, fle.status,
                fle.external_ref, fle.description, fle.metadata
         FROM financial_ledger_entries fle
         JOIN financial_accounts fa ON fa.id = fle.account_id
         WHERE fle.organization_id = ? AND fle.deleted_at IS NULL
           AND fa.source_module = 'INVEST'
           AND fle.external_ref = ?`,
        [ORG, ext]
      );
      if (!fin.length) {
        console.log(`  Caixa (${ext}): —`);
      } else {
        for (const r of fin) {
          const meta =
            typeof r.metadata === 'string'
              ? JSON.parse(r.metadata)
              : r.metadata || {};
          const fees = meta.fees ?? meta.b3_fees ?? '—';
          console.log(
            `  Caixa (${ext}): ${r.id} | ${String(r.transaction_date).slice(0, 10)} | ` +
              `${r.direction} R$ ${Number(r.amount).toFixed(2)} | status=${r.status} | fees=${fees}`
          );
        }
      }
    }
    console.log('');
  }

  // Resumo por nota (soma caixa das linhas da mesma nota)
  const noteGroups = new Map<string, string[]>();
  for (const ref of refs) {
    const m = ref.match(/BTG-NOTA-(\d+)#/);
    const note = m ? m[1]! : ref;
    const list = noteGroups.get(note) || [];
    list.push(ref);
    noteGroups.set(note, list);
  }

  console.log('='.repeat(72));
  console.log('RESUMO POR NOTA (pernas :CASH)');
  console.log('-'.repeat(72));

  for (const [note, lineRefs] of noteGroups) {
    let sumCash = 0;
    let cashCount = 0;
    const amounts: number[] = [];
    for (const ref of lineRefs) {
      const [fin] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT fle.amount, fle.direction
         FROM financial_ledger_entries fle
         WHERE fle.organization_id = ? AND fle.deleted_at IS NULL
           AND fle.external_ref = ?`,
        [ORG, `BROKER_REF:${ref}:CASH`]
      );
      for (const r of fin) {
        cashCount += 1;
        const signed = r.direction === 'out' ? -Number(r.amount) : Number(r.amount);
        amounts.push(signed);
        sumCash += signed;
      }
    }
    console.log(`Nota ${note}:`);
    console.log(`  Linhas patrimoniais conferidas: ${lineRefs.join(', ')}`);
    console.log(`  Lançamentos :CASH: ${cashCount}`);
    console.log(`  Valores individuais: ${amounts.map((a) => a.toFixed(2)).join(' + ') || '—'}`);
    console.log(`  Soma líquida caixa: R$ ${sumCash.toFixed(2)}`);
    if (cashCount === 0) {
      console.log('  → Sem perna :CASH: duplicata só na custódia (ou liquidação só no extrato).');
    } else if (cashCount === 1 && lineRefs.length === 2) {
      console.log('  → Uma única perna de caixa para duas pernas patrimoniais: provável duplicata só na carteira.');
    } else if (cashCount >= 2) {
      console.log('  → Duas (ou mais) pernas de caixa: caixa reflete as duas movimentações patrimoniais.');
    }
    console.log('');
  }

  // LIQ BOLSA no extrato (pregão) para as datas
  const dates = ['2026-04-27', '2026-04-28'];
  console.log('='.repeat(72));
  console.log('EXTRATO — LIQ BOLSA próximo ao pregão (referência externa)');
  console.log('-'.repeat(72));
  for (const d of dates) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT fle.transaction_date, fle.direction, fle.amount, fle.description, fle.external_ref, fle.metadata
       FROM financial_ledger_entries fle
       WHERE fle.organization_id = ? AND fle.deleted_at IS NULL
         AND fle.description LIKE '%LIQ BOLSA%'
         AND fle.transaction_date BETWEEN DATE_SUB(?, INTERVAL 5 DAY) AND DATE_ADD(?, INTERVAL 5 DAY)
       ORDER BY fle.transaction_date`,
      [ORG, d, d]
    );
    console.log(`\nPregão ${d} (janela D-5..D+5): ${rows.length} linha(s) LIQ BOLSA`);
    for (const r of rows.slice(0, 8)) {
      const signed = r.direction === 'out' ? -Number(r.amount) : Number(r.amount);
      console.log(
        `  ${String(r.transaction_date).slice(0, 10)} | R$ ${signed.toFixed(2)} | ${String(r.description).slice(0, 80)}`
      );
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
