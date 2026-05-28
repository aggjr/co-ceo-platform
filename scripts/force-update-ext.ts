import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const payloadItub = { pm_estrito: 41.5336, pm_b3: 41.1783, pm_gerencial: 41.0391 };
  const payloadWege = { pm_estrito: 44.2413, pm_b3: 43.9288, pm_gerencial: 43.5662 };
  const payloadPrio = { pm_estrito: 64.4741, pm_b3: 62.9463, pm_gerencial: 61.6845 };
  const payloadBbas = { pm_estrito: 21.2542, pm_b3: 21.0160, pm_gerencial: 20.9483 };
  
  const map = {
    'ITUB4': payloadItub,
    'WEGE3': payloadWege,
    'PRIO3': payloadPrio,
    'BBAS3': payloadBbas
  };
  
  for (const [ticker, p] of Object.entries(map)) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM patrimony_items WHERE identifier = ? AND organization_id = 'org-holding-001' AND status = 'active'`,
      [ticker]
    );
    if (rows.length > 0) {
      const id = rows[0].id;
      await pool.query(
        `UPDATE invest_position_ext SET pm_estrito = ?, pm_b3 = ?, pm_gerencial = ? WHERE patrimony_item_id = ?`,
        [p.pm_estrito, p.pm_b3, p.pm_gerencial, id]
      );
      console.log(`Updated ${ticker}`);
    }
  }
  
  await pool.end();
}

main().catch(console.error);
