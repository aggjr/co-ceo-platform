/**
 * Sincroniza séries de índices diários do BCB SGS (CDI, SELIC) em market_index_daily.
 *
 * BCB SGS expõe séries em JSON sem autenticação:
 *   https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados?dataInicial=DD/MM/AAAA&dataFinal=DD/MM/AAAA&formato=json
 *
 * Códigos usados:
 *   11   = CDI (% diária)
 *   1178 = SELIC over (% diária)
 *
 * Uso:
 *   npm run sync:market:indices
 *   npm run sync:market:indices -- --from=2026-01-01 --to=2026-05-22
 *   npm run sync:market:indices -- --from=2020-01-01      # backfill
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { authBootstrapContext } from '../src/core/auth/authBootstrapContext';
import { MarketQuoteRepository } from '../src/core/market/MarketQuoteRepository';

dotenv.config();

type IndexRateKind = 'daily_pct' | 'annual_pct';

type IndexSpec = { code: string; sgs: number; sourceTag: string; rateKind: IndexRateKind };

const INDICES: IndexSpec[] = [
  { code: 'CDI', sgs: 11, sourceTag: 'bcb_sgs_11', rateKind: 'daily_pct' },
  /** SGS 1178: taxa Selic em % a.a. (não é variação diária como o CDI). */
  { code: 'SELIC', sgs: 1178, sourceTag: 'bcb_sgs_1178', rateKind: 'annual_pct' },
];

function indexFactors(pct: number, rateKind: IndexRateKind): { dailyFactor: number; annualizedRate: number } {
  if (rateKind === 'annual_pct') {
    const annual = pct / 100;
    const dailyFactor = Math.pow(1 + annual, 1 / 252);
    return {
      dailyFactor: Math.round(dailyFactor * 1_000_000_000_000) / 1_000_000_000_000,
      annualizedRate: Math.round(annual * 1_000_000) / 1_000_000,
    };
  }
  const dailyFactor = 1 + pct / 100;
  const annualized = Math.pow(dailyFactor, 252) - 1;
  return {
    dailyFactor: Math.round(dailyFactor * 1_000_000_000_000) / 1_000_000_000_000,
    annualizedRate: Math.round(annualized * 1_000_000) / 1_000_000,
  };
}

function defaultFrom(): string {
  return process.env.MARKET_INDEX_SYNC_FROM || '1990-01-01';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(): { from: string; to: string } {
  let from = defaultFrom();
  let to = todayIso();
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--from=')) from = arg.slice(7).slice(0, 10);
    else if (arg.startsWith('--to=')) to = arg.slice(5).slice(0, 10);
  }
  if (from > to) {
    throw new Error(`from (${from}) > to (${to}).`);
  }
  return { from, to };
}

function isoToBr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function brToIso(br: string): string {
  const [d, m, y] = br.split('/');
  return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

type BcbRow = { data: string; valor: string };

async function fetchSgsSeries(sgs: number, from: string, to: string): Promise<BcbRow[]> {
  const url =
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${sgs}/dados` +
    `?dataInicial=${encodeURIComponent(isoToBr(from))}` +
    `&dataFinal=${encodeURIComponent(isoToBr(to))}` +
    `&formato=json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`BCB SGS ${sgs} HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as BcbRow[];
}

async function main() {
  const { from, to } = parseArgs();

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = authBootstrapContext();
  const repo = new MarketQuoteRepository(gateway);

  for (const idx of INDICES) {
    console.log(`\n[${idx.code}] BCB SGS ${idx.sgs}  ${from} → ${to}`);
    const rows = await fetchSgsSeries(idx.sgs, from, to);
    console.log(`  recebidos: ${rows.length} dia(s)`);

    let saved = 0;
    for (const r of rows) {
      const date = brToIso(r.data);
      const pct = Number(r.valor);
      if (!Number.isFinite(pct)) continue;
      const { dailyFactor, annualizedRate } = indexFactors(pct, idx.rateKind);
      await repo.upsertIndex(ctx, {
        indexCode: idx.code,
        referenceDate: date,
        dailyFactor,
        annualizedRate,
        source: idx.sourceTag,
      });
      saved += 1;
    }
    console.log(`  gravados: ${saved}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
