import * as fs from 'fs';
import * as path from 'path';
import { parseBrokerCustodySnapshotJson } from '../../../src/core/invest/brokerCustodySnapshotImport';
import {
  marksFromSnapshotLines,
  sumBrokerMarks,
} from '../../../src/core/invest/brokerCustodySnapshotTypes';

const fixturePath = path.join(
  __dirname,
  '../../fixtures/broker-custody-snapshot-btg-2026-05-23.json'
);

describe('broker custody snapshot (fixture, sem hardcode em código)', () => {
  const snap = parseBrokerCustodySnapshotJson(
    JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  );
  const allMarks = marksFromSnapshotLines(
    snap.positions.filter((p) => p.lineKind === 'mark')
  );

  it('soma ações conforme volume do snapshot', () => {
    const stocks = snap.positions.filter(
      (p) =>
        p.lineKind === 'mark' &&
        ['BBAS3', 'ITUB4', 'PRIO3', 'WEGE3'].includes(p.ticker)
    );
    expect(sumBrokerMarks(marksFromSnapshotLines(stocks))).toBe(1_302_733);
  });

  it('composição patrimonial fecha com derivativos negativos', () => {
    const { variableIncome, fixedIncome, cash, inTransit, derivatives, totalPatrimony } =
      snap.composition;
    const sum = variableIncome + fixedIncome + cash + inTransit + derivatives;
    expect(Math.round(sum * 100) / 100).toBe(totalPatrimony);
  });

  it('cada mark tem preço e volume coerentes em magnitude', () => {
    for (const m of allMarks) {
      const implied = Math.round(m.quantity * m.lastPrice * 100) / 100;
      expect(Math.abs(implied - m.marketValue)).toBeLessThanOrEqual(1);
    }
  });
});
