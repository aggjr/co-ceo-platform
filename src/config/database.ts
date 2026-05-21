import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Carrega as variáveis de ambiente (arquivo .env)
dotenv.config();

/**
 * Singleton do Pool de Conexão MySQL.
 * O Pool gerencia conexões reaproveitáveis, evitando sobrecarga no banco.
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'co_ceo_platform',
  waitForConnections: true,
  connectionLimit: process.env.DB_POOL_LIMIT ? parseInt(process.env.DB_POOL_LIMIT) : 20,
  queueLimit: 0
});

export default pool;
