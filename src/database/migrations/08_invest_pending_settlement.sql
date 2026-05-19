-- Previsão de liquidação (lançamentos futuros BTG) — ajusta patrimônio sem mexer no PM das ações

ALTER TABLE invest_ledger_entries
  MODIFY transaction_type ENUM(
    'buy',
    'sell',
    'dividend',
    'jcp',
    'split',
    'bonus',
    'option_exercise',
    'fee',
    'revaluation',
    'opening_balance',
    'put_sell',
    'put_buy',
    'call_sell',
    'call_buy',
    'securities_lending',
    'capital_deposit',
    'capital_withdrawal',
    'cash_yield',
    'penalty_b3',
    'pending_settlement'
  ) NOT NULL;
