import { sumPutSellPremiumForExercise } from '../../../src/core/invest/exercisePremium';

describe('exercisePremium', () => {
  it('soma put_sell proporcional à quantidade exercida', () => {
    const history = [
      {
        date: '2026-04-24',
        ticker: 'BBASQ223',
        operation: 'put_sell' as const,
        quantity: 300,
        total_net_value: 105,
      },
      {
        date: '2026-04-20',
        ticker: 'BBASQ223',
        operation: 'put_sell' as const,
        quantity: 200,
        total_net_value: 50,
      },
    ];
    expect(sumPutSellPremiumForExercise(history, 'BBASQ223', 300)).toBe(105);
    expect(sumPutSellPremiumForExercise(history, 'BBASQ223', 400)).toBe(130);
  });
});
