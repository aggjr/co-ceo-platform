ALTER TABLE `invest_portfolio_daily`
  ADD COLUMN IF NOT EXISTS `settled_cash` DECIMAL(18,4) NULL AFTER `positions_value`,
  ADD COLUMN IF NOT EXISTS `cash_in_transit` DECIMAL(18,4) NULL AFTER `settled_cash`;
