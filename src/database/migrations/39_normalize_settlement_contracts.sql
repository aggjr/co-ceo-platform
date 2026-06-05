DROP TABLE IF EXISTS invest_settlement_rules;

CREATE TABLE IF NOT EXISTS settlement_counterparties (
    counterparty_code VARCHAR(80) PRIMARY KEY,
    module_code VARCHAR(40) NOT NULL,
    counterparty_kind ENUM('exchange', 'broker', 'supplier', 'customer', 'internal', 'other') NOT NULL DEFAULT 'other',
    country_code CHAR(2) NULL,
    canonical_name VARCHAR(180) NOT NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_settlement_counterparties_module (module_code),
    INDEX idx_settlement_counterparties_kind (counterparty_kind)
);

CREATE TABLE IF NOT EXISTS settlement_contract_types (
    contract_type_code VARCHAR(80) PRIMARY KEY,
    module_code VARCHAR(40) NOT NULL,
    canonical_name VARCHAR(180) NOT NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_settlement_contract_types_module (module_code)
);

CREATE TABLE IF NOT EXISTS settlement_counterparty_contract_types (
    counterparty_code VARCHAR(80) NOT NULL,
    contract_type_code VARCHAR(80) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (counterparty_code, contract_type_code),
    CONSTRAINT fk_sct_counterparty_39
      FOREIGN KEY (counterparty_code) REFERENCES settlement_counterparties(counterparty_code)
      ON DELETE CASCADE,
    CONSTRAINT fk_sct_contract_type_39
      FOREIGN KEY (contract_type_code) REFERENCES settlement_contract_types(contract_type_code)
      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settlement_contract_rules (
    rule_code VARCHAR(80) PRIMARY KEY,
    contract_type_code VARCHAR(80) NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE NULL,
    days_offset INT NOT NULL DEFAULT 0,
    calendar_unit ENUM('business_days', 'calendar_days') NOT NULL DEFAULT 'business_days',
    business_calendar_code VARCHAR(40) NULL,
    default_status ENUM('pending', 'cleared') NOT NULL DEFAULT 'pending',
    label VARCHAR(180) NOT NULL,
    priority INT NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_scr_contract_type_39
      FOREIGN KEY (contract_type_code) REFERENCES settlement_contract_types(contract_type_code)
      ON DELETE CASCADE,
    INDEX idx_scr_contract_validity (contract_type_code, valid_from, valid_to),
    INDEX idx_scr_priority (priority)
);

CREATE TABLE IF NOT EXISTS settlement_rule_asset_types (
    rule_code VARCHAR(80) NOT NULL,
    asset_type VARCHAR(80) NOT NULL,
    PRIMARY KEY (rule_code, asset_type),
    CONSTRAINT fk_srat_rule_39
      FOREIGN KEY (rule_code) REFERENCES settlement_contract_rules(rule_code)
      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settlement_rule_transaction_types (
    rule_code VARCHAR(80) NOT NULL,
    transaction_type VARCHAR(80) NOT NULL,
    PRIMARY KEY (rule_code, transaction_type),
    CONSTRAINT fk_srtt_rule_39
      FOREIGN KEY (rule_code) REFERENCES settlement_contract_rules(rule_code)
      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settlement_rule_ticker_prefixes (
    rule_code VARCHAR(80) NOT NULL,
    ticker_prefix VARCHAR(40) NOT NULL,
    PRIMARY KEY (rule_code, ticker_prefix),
    CONSTRAINT fk_srtp_rule_39
      FOREIGN KEY (rule_code) REFERENCES settlement_contract_rules(rule_code)
      ON DELETE CASCADE
);

INSERT INTO settlement_counterparties
    (counterparty_code, module_code, counterparty_kind, country_code, canonical_name, description)
VALUES
    ('B3_BR', 'INVEST', 'exchange', 'BR', 'B3 Brasil Bolsa Balcao', 'Mercado brasileiro de renda variavel e derivativos.'),
    ('TESOURO_BR', 'INVEST', 'supplier', 'BR', 'Tesouro Direto', 'Fornecedor/mercado de titulos publicos federais.'),
    ('BTG_BR', 'INVEST', 'broker', 'BR', 'BTG Pactual', 'Corretora custodiante usada nos extratos BTG.')
ON DUPLICATE KEY UPDATE
    module_code = VALUES(module_code),
    counterparty_kind = VALUES(counterparty_kind),
    country_code = VALUES(country_code),
    canonical_name = VALUES(canonical_name),
    description = VALUES(description),
    is_active = TRUE;

INSERT INTO settlement_contract_types
    (contract_type_code, module_code, canonical_name, description)
VALUES
    ('B3_OPTION_PREMIUM', 'INVEST', 'Premio de opcao B3', 'Premios de compra/venda de opcoes padronizadas B3.'),
    ('B3_EQUITY_SPOT', 'INVEST', 'Mercado a vista B3', 'Acoes, FIIs, ETFs e BDRs negociados a vista.'),
    ('BR_FIXED_INCOME_SPOT', 'INVEST', 'Renda fixa Brasil', 'Titulos de renda fixa, Tesouro e CDBs.'),
    ('SECURITIES_LENDING', 'INVEST', 'Aluguel/termo de ativos', 'Contratos padronizados de aluguel/remuneracao/termo.')
ON DUPLICATE KEY UPDATE
    module_code = VALUES(module_code),
    canonical_name = VALUES(canonical_name),
    description = VALUES(description),
    is_active = TRUE;

INSERT INTO settlement_counterparty_contract_types
    (counterparty_code, contract_type_code, is_default)
VALUES
    ('B3_BR', 'B3_OPTION_PREMIUM', TRUE),
    ('B3_BR', 'B3_EQUITY_SPOT', TRUE),
    ('B3_BR', 'SECURITIES_LENDING', TRUE),
    ('TESOURO_BR', 'BR_FIXED_INCOME_SPOT', TRUE),
    ('BTG_BR', 'BR_FIXED_INCOME_SPOT', FALSE)
ON DUPLICATE KEY UPDATE
    is_default = VALUES(is_default),
    is_active = TRUE;

INSERT INTO settlement_contract_rules
    (rule_code, contract_type_code, valid_from, valid_to, days_offset, calendar_unit, business_calendar_code, default_status, label, priority)
VALUES
    ('B3_OPTION_PREMIUM_D1', 'B3_OPTION_PREMIUM', '1900-01-01', NULL, 1, 'business_days', 'B3', 'pending', 'Opcao - premio D+1 util', 10),
    ('B3_EQUITY_D3_LEGACY', 'B3_EQUITY_SPOT', '1900-01-01', '2019-05-26', 3, 'business_days', 'B3', 'pending', 'Acao/FII - liquidacao D+3 uteis (regra historica)', 10),
    ('B3_EQUITY_D2', 'B3_EQUITY_SPOT', '2019-05-27', NULL, 2, 'business_days', 'B3', 'pending', 'Acao/FII - liquidacao D+2 uteis', 10),
    ('TESOURO_D1', 'BR_FIXED_INCOME_SPOT', '1900-01-01', NULL, 1, 'business_days', 'B3', 'pending', 'Tesouro/RF - D+1 util', 5),
    ('CDB_D1', 'BR_FIXED_INCOME_SPOT', '1900-01-01', NULL, 1, 'business_days', 'B3', 'pending', 'CDB - D+1 util', 5),
    ('FIXED_INCOME_D1', 'BR_FIXED_INCOME_SPOT', '1900-01-01', NULL, 1, 'business_days', 'B3', 'pending', 'Renda fixa - D+1 util', 100),
    ('SECURITIES_LENDING_NET30', 'SECURITIES_LENDING', '1900-01-01', NULL, 30, 'calendar_days', NULL, 'pending', 'Aluguel/termo - liquidacao D+30 corridos', 10)
ON DUPLICATE KEY UPDATE
    contract_type_code = VALUES(contract_type_code),
    valid_from = VALUES(valid_from),
    valid_to = VALUES(valid_to),
    days_offset = VALUES(days_offset),
    calendar_unit = VALUES(calendar_unit),
    business_calendar_code = VALUES(business_calendar_code),
    default_status = VALUES(default_status),
    label = VALUES(label),
    priority = VALUES(priority),
    is_active = TRUE;

INSERT IGNORE INTO settlement_rule_asset_types (rule_code, asset_type) VALUES
    ('B3_OPTION_PREMIUM_D1', 'option_call'),
    ('B3_OPTION_PREMIUM_D1', 'option_put'),
    ('B3_EQUITY_D3_LEGACY', 'stock'),
    ('B3_EQUITY_D3_LEGACY', 'fii'),
    ('B3_EQUITY_D3_LEGACY', 'etf'),
    ('B3_EQUITY_D3_LEGACY', 'bdr'),
    ('B3_EQUITY_D2', 'stock'),
    ('B3_EQUITY_D2', 'fii'),
    ('B3_EQUITY_D2', 'etf'),
    ('B3_EQUITY_D2', 'bdr'),
    ('TESOURO_D1', 'fixed_income'),
    ('CDB_D1', 'fixed_income'),
    ('FIXED_INCOME_D1', 'fixed_income'),
    ('SECURITIES_LENDING_NET30', 'stock'),
    ('SECURITIES_LENDING_NET30', 'fii'),
    ('SECURITIES_LENDING_NET30', 'securities_lending');

INSERT IGNORE INTO settlement_rule_transaction_types (rule_code, transaction_type) VALUES
    ('B3_OPTION_PREMIUM_D1', 'call_sell'),
    ('B3_OPTION_PREMIUM_D1', 'put_sell'),
    ('B3_OPTION_PREMIUM_D1', 'call_buy'),
    ('B3_OPTION_PREMIUM_D1', 'put_buy'),
    ('B3_EQUITY_D3_LEGACY', 'buy'),
    ('B3_EQUITY_D3_LEGACY', 'sell'),
    ('B3_EQUITY_D2', 'buy'),
    ('B3_EQUITY_D2', 'sell'),
    ('TESOURO_D1', 'buy'),
    ('TESOURO_D1', 'sell'),
    ('CDB_D1', 'buy'),
    ('CDB_D1', 'sell'),
    ('FIXED_INCOME_D1', 'buy'),
    ('FIXED_INCOME_D1', 'sell'),
    ('SECURITIES_LENDING_NET30', 'securities_lending');

INSERT IGNORE INTO settlement_rule_ticker_prefixes (rule_code, ticker_prefix) VALUES
    ('TESOURO_D1', 'TESOURO-'),
    ('TESOURO_D1', 'TD-'),
    ('TESOURO_D1', 'LFT-'),
    ('CDB_D1', 'CDB-');
