/**
 * Snapshot de custódia BTG (telas Ações / Opções / composição) — referência estrutural.
 * Fonte: capturas do homebroker em mai/2026. Não é dado de runtime no repo.
 */

export type BrokerPositionMark = {
  ticker: string;
  quantity: number;
  lastPrice: number;
  /** Volume de mercado (qtd × preço) — pode ser negativo em vendidas. */
  marketValue: number;
};

export type BrokerPatrimonyComposition = {
  variableIncome: number;
  fixedIncome: number;
  cash: number;
  inTransit: number;
  derivatives: number;
  totalPatrimony: number;
  stocksVolume: number;
};

/** Composição patrimonial exibida pela corretora. */
export const BROKER_PATRIMONY_COMPOSITION: BrokerPatrimonyComposition = {
  variableIncome: 1_298_057.99,
  fixedIncome: 208_762.91,
  cash: 8_828.25,
  inTransit: 2_157.44,
  derivatives: -13_197.78,
  totalPatrimony: 1_504_608.81,
  stocksVolume: 1_302_733.0,
};

export const BROKER_STOCK_MARKS: BrokerPositionMark[] = [
  { ticker: 'BBAS3', quantity: 6_000, lastPrice: 20.91, marketValue: 125_460 },
  { ticker: 'ITUB4', quantity: 5_100, lastPrice: 39.41, marketValue: 200_991 },
  { ticker: 'PRIO3', quantity: 12_700, lastPrice: 68.41, marketValue: 868_807 },
  { ticker: 'WEGE3', quantity: 2_500, lastPrice: 42.99, marketValue: 107_475 },
];

/** Preço atual por ticker (opções) — telas Opções BTG. */
export const BROKER_OPTION_MARKS: BrokerPositionMark[] = [
  { ticker: 'BBASF224', quantity: -500, lastPrice: 0.22, marketValue: -110 },
  { ticker: 'BBASF231', quantity: -700, lastPrice: 0.1, marketValue: -70 },
  { ticker: 'ITUBF422', quantity: -300, lastPrice: 0.35, marketValue: -105 },
  { ticker: 'ITUBF427', quantity: 100, lastPrice: 0.27, marketValue: 27 },
  { ticker: 'ITUBF432', quantity: -700, lastPrice: 0.2, marketValue: -140 },
  { ticker: 'ITUBF435', quantity: -500, lastPrice: 0.18, marketValue: -90 },
  { ticker: 'ITUBF437', quantity: -900, lastPrice: 0.18, marketValue: -162 },
  { ticker: 'ITUBF445', quantity: -700, lastPrice: 0.11, marketValue: -77 },
  { ticker: 'ITUBR416', quantity: -700, lastPrice: 0.4, marketValue: -280 },
  { ticker: 'ITUBR424', quantity: -900, lastPrice: 0.6, marketValue: -540 },
  { ticker: 'ITUBR431', quantity: -700, lastPrice: 0.87, marketValue: -609 },
  { ticker: 'ITUBR436', quantity: -300, lastPrice: 1.1, marketValue: -330 },
  { ticker: 'PRIOF740', quantity: -600, lastPrice: 1.44, marketValue: -864 },
  { ticker: 'PRIOF750', quantity: -700, lastPrice: 1.18, marketValue: -826 },
  { ticker: 'PRIOF755', quantity: -700, lastPrice: 1.06, marketValue: -742 },
  { ticker: 'PRIOF760', quantity: -1_200, lastPrice: 1.0, marketValue: -1_200 },
  { ticker: 'PRIOF770', quantity: -900, lastPrice: 0.81, marketValue: -729 },
  { ticker: 'PRIOF775', quantity: -700, lastPrice: 0.7, marketValue: -490 },
  { ticker: 'PRIOF780', quantity: -500, lastPrice: 0.67, marketValue: -335 },
  { ticker: 'PRIOF785', quantity: -500, lastPrice: 0.62, marketValue: -310 },
  { ticker: 'PRIOF800', quantity: -900, lastPrice: 0.48, marketValue: -432 },
  { ticker: 'PRIOF820', quantity: -700, lastPrice: 0.33, marketValue: -231 },
  { ticker: 'PRIOR407', quantity: -6_500, lastPrice: 0.03, marketValue: -195 },
  { ticker: 'PRIOR560', quantity: -500, lastPrice: 0.25, marketValue: -125 },
  { ticker: 'PRIOR580', quantity: -900, lastPrice: 0.4, marketValue: -360 },
  { ticker: 'PRIOR590', quantity: -700, lastPrice: 0.44, marketValue: -308 },
  { ticker: 'PRIOR605', quantity: -300, lastPrice: 0.62, marketValue: -186 },
  { ticker: 'WEGEF476', quantity: -1_000, lastPrice: 0.29, marketValue: -290 },
  { ticker: 'WEGER441', quantity: -500, lastPrice: 0.58, marketValue: -290 },
  { ticker: 'WEGER417', quantity: -900, lastPrice: 0.81, marketValue: -729 },
  { ticker: 'WEGER435', quantity: -300, lastPrice: 1.44, marketValue: -432 },
  { ticker: 'WEGER448', quantity: -700, lastPrice: 1.2, marketValue: -840 },
];

export function sumBrokerMarks(marks: BrokerPositionMark[]): number {
  return Math.round(marks.reduce((s, m) => s + m.marketValue, 0) * 100) / 100;
}
