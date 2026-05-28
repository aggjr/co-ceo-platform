import { computePortfolioPerformance } from '../src/core/invest/portfolioPerformance';
import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [seriesRows] = await pool.query(`
    SELECT snapshot_date, patrimony 
    FROM invest_portfolio_daily 
    WHERE organization_id = 'org-holding-001' 
    ORDER BY snapshot_date ASC
  `);
  
  const series = (seriesRows as any[]).map(row => ({
    date: row.snapshot_date.toISOString().slice(0, 10),
    patrimony: Number(row.patrimony)
  }));
  
  const [eventsRows] = await pool.query(`
    SELECT transaction_date, movement_type as transaction_type, total_value as total_net_value 
    FROM patrimony_ledger_entries 
    WHERE organization_id = 'org-holding-001'
  `);
  
  const events = (eventsRows as any[]).map(row => ({
    transaction_date: row.transaction_date.toISOString().slice(0, 10),
    transaction_type: row.transaction_type,
    total_net_value: Number(row.total_net_value)
  }));
  
  const result = computePortfolioPerformance(
    series,
    events as any,
    '2026-01-01',
    '2026-05-27'
  );
  
  if (result) {
    for (const p of result.points) {
      if (p.date >= '2026-04-15' && p.date <= '2026-04-25') {
        console.log(p.date, 'Patrimony:', p.patrimony, 'TWR:', p.cumulativeReturnTwr, 'CF:', p.externalFlow);
      }
      if (p.date >= '2026-05-15' && p.date <= '2026-05-25') {
        console.log(p.date, 'Patrimony:', p.patrimony, 'TWR:', p.cumulativeReturnTwr, 'CF:', p.externalFlow);
      }
    }
  }
  
  await pool.end();
}

main().catch(console.error);
