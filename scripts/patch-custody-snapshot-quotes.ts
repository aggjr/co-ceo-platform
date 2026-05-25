/**
 * Atualiza lastPrice/marketValue no custody-snapshot.json (capturas MyProfit/BTG mai/2026).
 * Uso: npx ts-node scripts/patch-custody-snapshot-quotes.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const SNAP_PATH = path.join(
  process.cwd(),
  'local-import/btg-sources/custody-snapshot.json'
);

const QUOTES: Record<string, number> = {
  BBAS3: 21.32,
  ITUB4: 40.0,
  PRIO3: 66.73,
  WEGE3: 43.22,
  BBASF224: 0.32,
  BBASF231: 0.14,
  ITUBF422: 0.41,
  ITUBF427: 0.35,
  ITUBF432: 0.27,
  ITUBF435: 0.2,
  ITUBF437: 0.17,
  ITUBF445: 0.13,
  ITUBR416: 0.26,
  ITUBR424: 0.38,
  ITUBR431: 0.61,
  ITUBR436: 0.81,
  PRIOF740: 0.9,
  PRIOF750: 0.82,
  PRIOF755: 0.74,
  PRIOF760: 1.0,
  PRIOF770: 0.6,
  PRIOF775: 0.47,
  PRIOF780: 0.46,
  PRIOF785: 0.62,
  PRIOF800: 0.34,
  PRIOF820: 0.21,
  PRIOR407: 0.03,
  PRIOR560: 0.31,
  PRIOR580: 0.4,
  PRIOR590: 0.44,
  PRIOR605: 0.62,
  WEGEF476: 0.29,
  WEGER441: 0.5,
  WEGER417: 0.68,
  WEGER435: 1.2,
  WEGER448: 1.35,
};

function main() {
  if (!fs.existsSync(SNAP_PATH)) {
    console.error('Snapshot não encontrado:', SNAP_PATH);
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8')) as {
    sourceLabel?: string;
    referenceDate: string;
    composition: {
      cash: number;
      totalPatrimony: number;
      variableIncome: number;
      fixedIncome: number;
      inTransit: number;
      derivatives: number;
    };
    positions: Array<{
      ticker: string;
      lineKind: string;
      quantity: number;
      lastPrice?: number;
      marketValue?: number;
    }>;
  };

  snap.sourceLabel = 'btg_extrato_2026-05-23_myprofit_capturas';
  snap.referenceDate = '2026-05-23';
  snap.composition.cash = 8828.22;

  for (const p of snap.positions) {
    const px = QUOTES[p.ticker.toUpperCase()];
    if (px == null || p.lineKind !== 'mark') continue;
    p.lastPrice = px;
    p.marketValue = Math.round(p.quantity * px * 100) / 100;
  }

  const marks = snap.positions.filter((p) => p.lineKind === 'mark');
  const varIncome = Math.round(marks.reduce((s, p) => s + (p.marketValue ?? 0), 0) * 100) / 100;
  snap.composition.variableIncome = varIncome;
  snap.composition.totalPatrimony =
    Math.round(
      (varIncome +
        snap.composition.fixedIncome +
        snap.composition.cash +
        snap.composition.inTransit +
        snap.composition.derivatives) *
        100
    ) / 100;

  fs.writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2), 'utf8');
  console.log('Snapshot atualizado:', SNAP_PATH);
  console.log('RV marks:', varIncome, '| caixa:', snap.composition.cash, '| total:', snap.composition.totalPatrimony);
}

main();
