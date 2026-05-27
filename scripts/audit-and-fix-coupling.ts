/**
 * Script de varredura e limpeza do histórico financeiro e patrimonial.
 * Alinha os registros antigos à Visão Final do Acoplamento.
 *
 * Modo de uso:
 *   npx ts-node scripts/audit-and-fix-coupling.ts --dry-run
 *   npx ts-node scripts/audit-and-fix-coupling.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  const dbName = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';

  if (!password && host === '127.0.0.1') {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: dbName,
    charset: 'utf8mb4',
  });

  console.log(`Conectado ao banco: ${dbName} @ ${host}`);
  if (DRY_RUN) {
    console.log('>>> MODO DRY-RUN: Nenhuma alteração será feita <<<\n');
  }

  try {
    // 1. Limpeza de Corporate Actions (GAP 1) - Pernas financeiras com amount = 0
    console.log('=== 1. Limpeza de Pernas Financeiras Zeradas ===');
    const [zeroFin] = await pool.query<mysql.RowDataPacket[]>(`
      SELECT id, external_ref, description
      FROM financial_ledger_entries
      WHERE amount = 0 AND deleted_at IS NULL
    `);
    console.log(`Pernas financeiras encontradas (amount = 0): ${zeroFin.length}`);
    for (const row of zeroFin) {
      console.log(`  - ID: ${row.id} | Ref: ${row.external_ref} | Desc: ${row.description}`);
      if (!DRY_RUN) {
        await pool.query(`UPDATE financial_ledger_entries SET deleted_at = NOW() WHERE id = ?`, [row.id]);
      }
    }

    // 2. Limpeza de Proventos Órfãos (GAP 3) - income_in_kind sem link financeiro
    console.log('\n=== 2. Limpeza de Pernas Patrimoniais Órfãs de Proventos ===');
    const [orphanPat] = await pool.query<mysql.RowDataPacket[]>(`
      SELECT ple.id, ple.external_ref, ple.metadata
      FROM patrimony_ledger_entries ple
      WHERE ple.movement_type = 'income_in_kind'
        AND ple.related_financial_entry_id IS NULL
        AND ple.deleted_at IS NULL
    `);
    console.log(`Pernas patrimoniais órfãs (income_in_kind): ${orphanPat.length}`);
    for (const row of orphanPat) {
      console.log(`  - ID: ${row.id} | Ref: ${row.external_ref}`);
      if (!DRY_RUN) {
        await pool.query(`UPDATE patrimony_ledger_entries SET deleted_at = NOW() WHERE id = ?`, [row.id]);
      }
    }

    // 3. Reparação de Links Bidirecionais Faltantes (GAP 5)
    console.log('\n=== 3. Reparação de Links Bidirecionais ===');
    // Procura por pares patrimônio/financeiro com o mesmo external_ref que não estejam linkados
    const [unlinkedPairs] = await pool.query<mysql.RowDataPacket[]>(`
      SELECT 
        ple.id AS ple_id, 
        fle.id AS fle_id, 
        ple.external_ref
      FROM patrimony_ledger_entries ple
      JOIN financial_ledger_entries fle 
        ON ple.external_ref = fle.external_ref
        AND ple.organization_id = fle.organization_id
      WHERE ple.external_ref IS NOT NULL 
        AND ple.deleted_at IS NULL 
        AND fle.deleted_at IS NULL
        AND (ple.related_financial_entry_id IS NULL OR fle.related_patrimony_ledger_id IS NULL)
    `);
    console.log(`Pares desvinculados encontrados (mesmo external_ref): ${unlinkedPairs.length}`);
    for (const row of unlinkedPairs) {
      console.log(`  - Linkando PLE_ID: ${row.ple_id} com FLE_ID: ${row.fle_id} (Ref: ${row.external_ref})`);
      if (!DRY_RUN) {
        await pool.query(`UPDATE patrimony_ledger_entries SET related_financial_entry_id = ? WHERE id = ?`, [row.fle_id, row.ple_id]);
        await pool.query(`UPDATE financial_ledger_entries SET related_patrimony_ledger_id = ? WHERE id = ?`, [row.ple_id, row.fle_id]);
      }
    }

    // 4. Varredura de Duplicidades Gerais (Double Entry Risk)
    console.log('\n=== 4. Varredura de Duplicidades ===');
    // Duplicatas na financial_ledger_entries pelo external_ref
    const [finDupes] = await pool.query<mysql.RowDataPacket[]>(`
      SELECT external_ref, COUNT(*) as c
      FROM financial_ledger_entries
      WHERE external_ref IS NOT NULL AND external_ref != '' AND deleted_at IS NULL
      GROUP BY external_ref
      HAVING c > 1
    `);
    console.log(`Grupos de duplicatas financeiras por external_ref: ${finDupes.length}`);
    for (const dupe of finDupes) {
      const ref = dupe.external_ref;
      const [rows] = await pool.query<mysql.RowDataPacket[]>(`
        SELECT id, amount FROM financial_ledger_entries 
        WHERE external_ref = ? AND deleted_at IS NULL 
        ORDER BY created_at ASC
      `, [ref]);
      
      // Mantém a primeira linha (mais antiga), deleta as demais
      for (let i = 1; i < rows.length; i++) {
        console.log(`  - Deletando duplicata financeira ID: ${rows[i].id} (Ref: ${ref})`);
        if (!DRY_RUN) {
          await pool.query(`UPDATE financial_ledger_entries SET deleted_at = NOW() WHERE id = ?`, [rows[i].id]);
        }
      }
    }

    // Duplicatas na patrimony_ledger_entries pelo external_ref
    const [patDupes] = await pool.query<mysql.RowDataPacket[]>(`
      SELECT external_ref, COUNT(*) as c
      FROM patrimony_ledger_entries
      WHERE external_ref IS NOT NULL AND external_ref != '' AND deleted_at IS NULL
      GROUP BY external_ref
      HAVING c > 1
    `);
    console.log(`Grupos de duplicatas patrimoniais por external_ref: ${patDupes.length}`);
    for (const dupe of patDupes) {
      const ref = dupe.external_ref;
      const [rows] = await pool.query<mysql.RowDataPacket[]>(`
        SELECT id FROM patrimony_ledger_entries 
        WHERE external_ref = ? AND deleted_at IS NULL 
        ORDER BY created_at ASC
      `, [ref]);
      
      for (let i = 1; i < rows.length; i++) {
        console.log(`  - Deletando duplicata patrimonial ID: ${rows[i].id} (Ref: ${ref})`);
        if (!DRY_RUN) {
          await pool.query(`UPDATE patrimony_ledger_entries SET deleted_at = NOW() WHERE id = ?`, [rows[i].id]);
        }
      }
    }

  } catch (error) {
    console.error('Erro na varredura:', error);
  } finally {
    await pool.end();
    if (DRY_RUN) {
      console.log('\n(Modo DRY-RUN concluído com sucesso. Execute sem a flag --dry-run para aplicar.)');
    } else {
      console.log('\nVarredura e limpeza concluídas.');
    }
  }
}

main().catch(console.error);
