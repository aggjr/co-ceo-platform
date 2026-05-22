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
    console.log('Iniciando limpeza total do banco de dados...');
    
    // Desabilitar checagem de chave estrangeira temporariamente
    await connection.query('SET FOREIGN_KEY_CHECKS = 0;');

    // 1. Apagar todas as transações e ativos
    console.log('Apagando dados de transações (invest_ledger_entries, invest_assets, etc)...');
    await connection.query('TRUNCATE TABLE invest_ledger_entries;');
    await connection.query('TRUNCATE TABLE invest_assets;');
    await connection.query('TRUNCATE TABLE invest_daily_snapshots;');
    await connection.query('TRUNCATE TABLE invest_portfolio_daily;');
    await connection.query('TRUNCATE TABLE invest_options_chain;');

    // 2. Apagar usuários, exceto os administradores
    console.log('Apagando todos os usuários (exceto admin@co-ceo.com e admin@coceo.com.br)...');
    await connection.query(`
      DELETE FROM users 
      WHERE email NOT IN ('admin@co-ceo.com', 'admin@coceo.com.br');
    `);

    // 3. Limpar tabelas de junção/papéis de usuários que foram excluídos
    console.log('Limpando relacionamentos órfãos...');
    await connection.query(`
      DELETE FROM user_roles 
      WHERE user_id NOT IN (SELECT id FROM users);
    `);
    await connection.query(`
      DELETE FROM role_resource_grants 
      WHERE role_id NOT IN (SELECT id FROM roles);
    `);

    // Habilitar novamente
    await connection.query('SET FOREIGN_KEY_CHECKS = 1;');
    
    console.log('✅ Limpeza concluída com sucesso!');
    console.log('Agora o banco de dados contém apenas as configurações base e os usuários administradores.');
  } catch (error) {
    console.error('Erro ao limpar banco de dados:', error);
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(console.error);
