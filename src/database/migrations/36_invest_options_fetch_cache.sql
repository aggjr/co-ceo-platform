-- Cache global de tentativas de busca historica de opcoes.
-- Evita repetir consultas caras/indisponiveis para a mesma opcao e data.

CREATE TABLE IF NOT EXISTS invest_options_fetch_cache (
    ticker VARCHAR(20) NOT NULL,
    quote_date DATE NOT NULL,
    fetch_date DATE NOT NULL,
    closing_price DECIMAL(18, 6) NULL,
    status ENUM('FOUND', 'NOT_FOUND') NOT NULL DEFAULT 'NOT_FOUND',
    source VARCHAR(80) NOT NULL DEFAULT 'unknown',
    source_system VARCHAR(80) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker, quote_date),
    INDEX idx_option_fetch_ticker_status (ticker, status),
    INDEX idx_option_fetch_date (fetch_date)
);
