-- Fluxo de caixa / extrato mensal (aportes, retiradas, rendimento de saldo, multas B3)

ALTER TABLE invest_assets
  MODIFY asset_type ENUM(
    'stock',
    'option_call',
    'option_put',
    'fii',
    'fixed_income',
    'alternative',
    'artwork',
    'real_estate',
    'cash'
  ) NOT NULL;

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
    'penalty_b3'
  ) NOT NULL;
