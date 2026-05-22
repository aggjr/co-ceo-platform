-- ==============================================================================
-- CO-CEO PLATFORM | NUCLEO PATRIMONIAL CANONICO
-- ver: docs/architecture/nucleo_patrimonial.md
-- ==============================================================================
-- Catalogo universal de "coisas que a empresa possui". Acoes, FIIs, opcoes,
-- SKUs, materia-prima, imoveis, veiculos, cursos digitais — todos vivem aqui.
-- Atributos especificos de cada dominio ficam em tabelas de extensao por modulo.

CREATE TABLE patrimony_items (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    source_module VARCHAR(50) NOT NULL,
    category VARCHAR(50) NOT NULL,
    subcategory VARCHAR(50) NOT NULL,
    identifier VARCHAR(64) NOT NULL,
    name VARCHAR(255) NULL,
    quantity DECIMAL(18, 6) NOT NULL DEFAULT 0,
    quantity_unit VARCHAR(16) NOT NULL DEFAULT 'un',
    acquisition_value DECIMAL(18, 4) NULL,
    current_value DECIMAL(18, 4) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'BRL',
    acquired_at DATE NULL,
    divested_at DATE NULL,
    status ENUM('active', 'liquidated', 'written_off') NOT NULL DEFAULT 'active',
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (source_module) REFERENCES modules(code),
    UNIQUE KEY uk_patrimony_org_module_identifier (organization_id, source_module, identifier),
    INDEX idx_patrimony_org_category (organization_id, category, subcategory),
    INDEX idx_patrimony_org_status (organization_id, status)
);

-- Locais onde os itens estao: corretora (account_id), armazem fisico (address),
-- diretorio digital (url/path), imovel (o proprio item E o local).
CREATE TABLE patrimony_locations (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    location_type VARCHAR(40) NOT NULL,
    name VARCHAR(255) NOT NULL,
    external_id VARCHAR(128) NULL,
    address_line VARCHAR(500) NULL,
    url VARCHAR(500) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    INDEX idx_locations_org_type (organization_id, location_type)
);

-- Item × local × quantidade. Permite item parcialmente em N locais
-- (ex.: SKU dividido em 2 armazens; acao toda em 1 corretora).
CREATE TABLE patrimony_item_locations (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    patrimony_item_id VARCHAR(36) NOT NULL,
    location_id VARCHAR(36) NOT NULL,
    quantity_at_location DECIMAL(18, 6) NOT NULL DEFAULT 0,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (patrimony_item_id) REFERENCES patrimony_items(id),
    FOREIGN KEY (location_id) REFERENCES patrimony_locations(id),
    UNIQUE KEY uk_item_location (patrimony_item_id, location_id)
);

-- Livro razao de movimentacao de posicao (entrada/saida/transferencia/revalorizacao).
-- Cada lancamento que tambem move dinheiro liga-se a financial_ledger_entries via FK reciproca.
CREATE TABLE patrimony_ledger_entries (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    patrimony_item_id VARCHAR(36) NOT NULL,
    location_id VARCHAR(36) NULL,
    transaction_date DATE NOT NULL,
    movement_type ENUM(
        'opening_balance',
        'acquisition',
        'disposition',
        'transfer_in',
        'transfer_out',
        'revaluation',
        'split',
        'bonus',
        'write_off',
        'short_open',
        'short_close',
        'income_in_kind'
    ) NOT NULL,
    quantity_delta DECIMAL(18, 6) NOT NULL,
    unit_value DECIMAL(18, 6) NOT NULL,
    total_value DECIMAL(18, 4) NOT NULL,
    impacts_valuation BOOLEAN NOT NULL DEFAULT TRUE,
    source_batch_id VARCHAR(36) NULL,
    external_ref VARCHAR(128) NULL,
    notes VARCHAR(500) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (patrimony_item_id) REFERENCES patrimony_items(id),
    FOREIGN KEY (location_id) REFERENCES patrimony_locations(id),
    INDEX idx_patrimony_ledger_org_date (organization_id, transaction_date),
    INDEX idx_patrimony_ledger_item_date (patrimony_item_id, transaction_date),
    INDEX idx_patrimony_ledger_ref (organization_id, external_ref)
);

-- Fechamentos genericos: snapshot agregado em data de referencia.
CREATE TABLE patrimony_closings (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    scope ENUM('inventory', 'financial', 'full') NOT NULL,
    period ENUM('daily', 'weekly', 'monthly', 'quarterly', 'annual') NOT NULL,
    reference_date DATE NOT NULL,
    status ENUM('open', 'in_progress', 'closed', 'reopened') NOT NULL DEFAULT 'open',
    closed_by_user_id VARCHAR(36) NULL,
    closed_at TIMESTAMP NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY uk_closing_org_scope_date (organization_id, scope, period, reference_date)
);
