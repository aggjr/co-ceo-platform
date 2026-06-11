-- ==============================================================================
-- CO-CEO PLATFORM | MARKET INSTRUMENTS — adicionar coluna strike_price
-- Necessário para armazenar o strike de opções no catálogo global de instrumentos.
-- Strike é dado do contrato, não preço de mercado (não pertence a market_quotes_daily).
-- ==============================================================================

ALTER TABLE market_instruments
    ADD COLUMN strike_price DECIMAL(18, 6) NULL AFTER pre_rate,
    ADD COLUMN last_synced_at TIMESTAMP NULL AFTER metadata;

-- Índice para busca rápida por ativo-objeto + vencimento (útil para cadeia de opções)
ALTER TABLE market_instruments
    ADD INDEX idx_market_instruments_underlying_expiry (underlying_ticker, maturity_date);
