/**
 * Referência MyProfit / HomeBroker — LFT-20310301 (fixture de teste).
 * Abertura: 58 cotas @ 17.809,83 (R$ 1.032.969,97).
 */
export type MyProfitLftTrade = {
  date: string;
  side: 'buy' | 'sell';
  quantity: number;
  unitPrice: number;
  total: number;
};

export const MYPROFIT_LFT_TRADES: MyProfitLftTrade[] = [
  { date: '2026-01-09', side: 'buy', quantity: 3, unitPrice: 18_053.36, total: 54_160.08 },
  { date: '2026-01-22', side: 'buy', quantity: 10, unitPrice: 18_145.34, total: 181_453.4 },
  { date: '2026-01-28', side: 'buy', quantity: 2.89, unitPrice: 18_185.84, total: 52_557.08 },
  { date: '2026-02-04', side: 'buy', quantity: 0.19, unitPrice: 18_235.75, total: 3_464.79 },
  { date: '2026-02-10', side: 'buy', quantity: 0.13, unitPrice: 18_275.72, total: 2_375.84 },
  { date: '2026-03-09', side: 'buy', quantity: 0.62, unitPrice: 18_449.66, total: 11_438.79 },
  { date: '2026-03-18', side: 'buy', quantity: 0.64, unitPrice: 18_523.02, total: 11_854.73 },
  { date: '2026-03-23', side: 'buy', quantity: 0.7, unitPrice: 18_554.11, total: 12_987.88 },
  { date: '2026-04-22', side: 'sell', quantity: 35.17, unitPrice: 18_759.45, total: 659_769.86 },
  { date: '2026-04-23', side: 'sell', quantity: 1, unitPrice: 18_769.75, total: 18_769.75 },
  { date: '2026-04-23', side: 'sell', quantity: 7, unitPrice: 18_769.75, total: 131_388.25 },
  { date: '2026-05-18', side: 'sell', quantity: 4, unitPrice: 18_935.72, total: 75_742.88 },
  { date: '2026-05-18', side: 'sell', quantity: 3, unitPrice: 18_935.72, total: 56_807.16 },
  { date: '2026-05-18', side: 'sell', quantity: 15, unitPrice: 18_935.72, total: 284_035.8 },
];

export const MYPROFIT_LFT_OPENING_QTY = 58;

export function myProfitLftNetQty(): number {
  let qty = MYPROFIT_LFT_OPENING_QTY;
  for (const t of MYPROFIT_LFT_TRADES) {
    qty += t.side === 'buy' ? t.quantity : -t.quantity;
  }
  return Math.round(qty * 100) / 100;
}
