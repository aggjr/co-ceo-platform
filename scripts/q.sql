SELECT
  a.ticker,
  e.entry_type,
  e.option_ticker,
  e.quantity,
  e.unit_price,
  e.gross_amount,
  e.net_amount
FROM invest_ledger_entries e
JOIN invest_assets a ON a.id = e.asset_id
WHERE e.operation_date = '2026-01-01';
