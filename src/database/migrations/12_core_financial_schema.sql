-- ==============================================================================
-- CO-CEO PLATFORM | NUCLEO FINANCEIRO CANONICO
-- ver: docs/architecture/nucleo_patrimonial.md
-- ==============================================================================
-- Qualquer "conta com saldo": banco, corretora, caixa fisico, gateway, linha de
-- credito. Substitui o uso anterior de invest_assets com type='cash'.

CREATE TABLE financial_accounts (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    source_module VARCHAR(50) NOT NULL,
    account_type ENUM(
        'checking',
        'savings',
        'brokerage',
        'cash_register',
        'credit_line',
        'gateway',
        'wallet'
    ) NOT NULL,
    external_id VARCHAR(128) NULL,
    name VARCHAR(255) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'BRL',
    opening_balance DECIMAL(18, 4) NOT NULL DEFAULT 0,
    opening_date DATE NULL,
    status ENUM('active', 'closed') NOT NULL DEFAULT 'active',
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (source_module) REFERENCES modules(code),
    UNIQUE KEY uk_fin_account_org_external (organization_id, source_module, external_id, name),
    INDEX idx_fin_account_org_status (organization_id, status)
);

-- Livro razao financeiro = extrato canonico. Toda entrada/saida de dinheiro
-- aparece aqui, com data de transacao + data de liquidacao + status.
CREATE TABLE financial_ledger_entries (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    account_id VARCHAR(36) NOT NULL,
    transaction_date DATE NOT NULL,
    settlement_date DATE NOT NULL,
    direction ENUM('in', 'out') NOT NULL,
    amount DECIMAL(18, 4) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'BRL',
    description VARCHAR(500) NULL,
    counterparty VARCHAR(255) NULL,
    status ENUM('pending', 'cleared', 'cancelled') NOT NULL DEFAULT 'cleared',
    related_patrimony_ledger_id VARCHAR(36) NULL,
    source_batch_id VARCHAR(36) NULL,
    external_ref VARCHAR(128) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (account_id) REFERENCES financial_accounts(id),
    FOREIGN KEY (related_patrimony_ledger_id) REFERENCES patrimony_ledger_entries(id),
    INDEX idx_fin_ledger_org_date (organization_id, transaction_date),
    INDEX idx_fin_ledger_account_date (account_id, transaction_date),
    INDEX idx_fin_ledger_settlement (organization_id, settlement_date, status),
    INDEX idx_fin_ledger_ref (organization_id, external_ref)
);

-- FK reciproca: patrimony_ledger pode apontar para a perna financeira correspondente.
ALTER TABLE patrimony_ledger_entries
    ADD COLUMN related_financial_entry_id VARCHAR(36) NULL,
    ADD CONSTRAINT fk_patrimony_ledger_financial
        FOREIGN KEY (related_financial_entry_id) REFERENCES financial_ledger_entries(id);

CREATE TABLE financial_closings (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    account_id VARCHAR(36) NULL,
    period ENUM('daily', 'weekly', 'monthly', 'quarterly', 'annual') NOT NULL,
    reference_date DATE NOT NULL,
    opening_balance DECIMAL(18, 4) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(18, 4) NOT NULL DEFAULT 0,
    total_in DECIMAL(18, 4) NOT NULL DEFAULT 0,
    total_out DECIMAL(18, 4) NOT NULL DEFAULT 0,
    pending_amount DECIMAL(18, 4) NOT NULL DEFAULT 0,
    status ENUM('open', 'in_progress', 'closed', 'reopened') NOT NULL DEFAULT 'open',
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (account_id) REFERENCES financial_accounts(id),
    UNIQUE KEY uk_fin_closing (organization_id, account_id, period, reference_date)
);
