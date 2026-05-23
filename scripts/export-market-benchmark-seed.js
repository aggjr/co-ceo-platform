require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const [cdi] = await conn.query(
    `SELECT id, index_code, reference_date, daily_factor, annualized_rate, source
     FROM market_index_daily WHERE index_code = 'CDI' ORDER BY reference_date`
  );
  const [prio] = await conn.query(
    `SELECT id, ticker, quote_date, closing_price, source, metadata
     FROM market_quotes_daily WHERE ticker = 'PRIO3' ORDER BY quote_date`
  );

  const lines = [
    '-- Seed benchmarks globais (CDI + PRIO3) — idempotente via INSERT IGNORE',
    '-- Gerado a partir do banco local; complementar ao npm run seed:market:benchmarks',
    '',
  ];

  for (const r of cdi) {
    const d = r.reference_date instanceof Date
      ? r.reference_date.toISOString().slice(0, 10)
      : String(r.reference_date).slice(0, 10);
    lines.push(
      `INSERT IGNORE INTO market_index_daily (id, index_code, reference_date, daily_factor, annualized_rate, source) VALUES (` +
        `'${r.id}', 'CDI', '${d}', ${r.daily_factor}, ${r.annualized_rate ?? 'NULL'}, '${r.source}');`
    );
  }

  for (const r of prio) {
    const d = r.quote_date instanceof Date
      ? r.quote_date.toISOString().slice(0, 10)
      : String(r.quote_date).slice(0, 10);
    const meta = r.metadata
      ? `'${String(typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata)).replace(/'/g, "''")}'`
      : 'NULL';
    lines.push(
      `INSERT IGNORE INTO market_quotes_daily (id, ticker, quote_date, closing_price, currency, source, metadata) VALUES (` +
        `'${r.id}', 'PRIO3', '${d}', ${r.closing_price}, 'BRL', '${r.source}', ${meta});`
    );
  }

  const out = path.join(__dirname, '..', 'src', 'database', 'migrations', '23_market_benchmark_seed.sql');
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.log('OK', out, 'CDI:', cdi.length, 'PRIO3:', prio.length);
  await conn.end();
})();
