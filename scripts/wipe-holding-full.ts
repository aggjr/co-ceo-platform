import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const connection = await pool.getConnection();

  try {
    console.log('Iniciando limpeza total dos dados de investimento/patrimônio...');
    
    // Desabilitar checagem de chave estrangeira temporariamente
    await connection.query('SET FOREIGN_KEY_CHECKS = 0;');

    const tablesToTruncate = [
      'invest_ledger_entries',
      'invest_assets',
      'invest_daily_snapshots',
      'invest_portfolio_daily',
      'invest_options_chain',
      'organization_storage_ledger',
      'financial_ledger_entries',
      'patrimony_ledger_entries',
      'patrimony_items',
      'invest_position_ext',
      'invest_option_ext'
    ];

    for (const table of tablesToTruncate) {
      try {
        await connection.query(`TRUNCATE TABLE \`${table}\`;`);
        console.log(`[OK] Tabela truncada: ${table} (contador zerado)`);
      } catch (err: any) {
        if (err.code === 'ER_NO_SUCH_TABLE') {
          console.log(`[IGNORADO] Tabela não existe: ${table}`);
        } else {
          console.error(`[ERRO] Falha ao truncar ${table}:`, err.message);
        }
      }
    }
    
    console.log('Resetando contadores de storage...');
    await connection.query('UPDATE organizations SET storage_bytes_used = 0;');
    console.log('[OK] Contadores de volume de dados (storage_bytes_used) zerados.');

    // Habilitar novamente
    await connection.query('SET FOREIGN_KEY_CHECKS = 1;');
    
    console.log('✅ Limpeza concluída com sucesso! Os contadores auto_increment também foram zerados.');
  } catch (error) {
    console.error('Erro ao limpar banco de dados:', error);
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(console.error);
