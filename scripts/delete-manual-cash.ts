import 'dotenv/config';
import mysql from 'mysql2/promise';

async function run() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || 'localhost';
  const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD;
  const user = process.env.REMOTE_DB_USER || process.env.DB_USER || 'root';
  const database = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_db';

  if (!password) {
    console.log('Sem senha configurada para o banco.');
    return;
  }

  const pool = mysql.createPool({ host, user, password, database });

  try {
    // Apaga apenas os saldos iniciais que NÃO possuem business_event_id.
    // O saldo com rastreabilidade vindo do extrato BTG (documento original)
    // estará linkado a um business_event.
    const [result1] = await pool.execute(`
      DELETE FROM financial_ledger_entries 
      WHERE (description LIKE '%Saldo inicial%' OR JSON_EXTRACT(metadata, '$.legacy_op') = 'opening_balance')
      AND business_event_id IS NULL
    `);
    console.log('Lançamentos manuais de caixa (sem business_event_id) apagados:', (result1 as any).affectedRows);

    // Ajusta o account se estiver desbalanceado. Como o saldo passará a vir apenas
    // do lançamento rastreável que sobrou no ledger, zeramos no cadastro da conta.
    const [result2] = await pool.execute(`
      UPDATE financial_accounts 
      SET opening_balance = 0 
      WHERE opening_balance != 0
    `);
    console.log('Saldos engessados em financial_accounts zerados:', (result2 as any).affectedRows);

  } catch (err) {
    console.error('Erro ao limpar base:', err);
  } finally {
    await pool.end();
  }
}

run().catch(console.error);
