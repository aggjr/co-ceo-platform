import {
  BROKER_OPTION_MARKS,
  BROKER_PATRIMONY_COMPOSITION,
  BROKER_STOCK_MARKS,
  sumBrokerMarks,
} from '../../../src/core/invest/brokerHoldingSnapshot';

describe('brokerHoldingSnapshot', () => {
  it('soma ações conforme volume BTG', () => {
    expect(sumBrokerMarks(BROKER_STOCK_MARKS)).toBe(1_302_733);
  });

  it('composição patrimonial fecha com derivativos negativos', () => {
    const { variableIncome, fixedIncome, cash, inTransit, derivatives, totalPatrimony } =
      BROKER_PATRIMONY_COMPOSITION;
    const sum = variableIncome + fixedIncome + cash + inTransit + derivatives;
    expect(Math.round(sum * 100) / 100).toBe(totalPatrimony);
  });

  it('cada mark tem preço e volume coerentes em magnitude', () => {
    for (const m of [...BROKER_STOCK_MARKS, ...BROKER_OPTION_MARKS]) {
      const implied = Math.round(m.quantity * m.lastPrice * 100) / 100;
      expect(Math.abs(implied - m.marketValue)).toBeLessThanOrEqual(1);
    }
  });
});
