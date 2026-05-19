import type { LedgerImportLine } from './ledgerTypes';

type PremiumLine = Pick<
  LedgerImportLine,
  'ticker' | 'operation' | 'quantity' | 'total_net_value' | 'date'
>;

/**
 * Soma o prêmio líquido recebido em `put_sell` da série (para ajuste B3 no exercício).
 * Usa as vendas mais recentes primeiro até cobrir `exerciseQty`.
 */
export function sumPutSellPremiumForExercise(
  history: PremiumLine[],
  optionTicker: string,
  exerciseQty: number
): number {
  const key = optionTicker.trim().toUpperCase();
  let remaining = Math.abs(exerciseQty);
  let premium = 0;

  const sells = history
    .filter((e) => e.ticker.toUpperCase() === key && e.operation === 'put_sell')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  for (const e of sells) {
    if (remaining <= 0) break;
    const q = Math.abs(Number(e.quantity));
    if (q <= 0) continue;
    const take = Math.min(remaining, q);
    const net = Number(e.total_net_value ?? 0);
    premium += (net / q) * take;
    remaining -= take;
  }

  return Math.round(premium * 100) / 100;
}
