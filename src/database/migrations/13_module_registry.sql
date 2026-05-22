-- ==============================================================================
-- CO-CEO PLATFORM | REGISTRY DE MODULOS
-- ver: docs/architecture/nucleo_patrimonial.md
-- ==============================================================================
-- Catalogo de subcategorias dominadas por cada modulo. Usado pelo ContractGuard
-- no gateway para validar (subcategory -> source_module -> contract_modules).
--
-- E dado, nao codigo: nova subcategoria entra via seed, nunca por string
-- hardcoded em service.

CREATE TABLE module_categories (
    module_code VARCHAR(50) NOT NULL,
    category VARCHAR(50) NOT NULL,
    subcategory VARCHAR(50) NOT NULL,
    canonical_name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    default_quantity_unit VARCHAR(16) NOT NULL DEFAULT 'un',
    default_valuation_method VARCHAR(64) NOT NULL DEFAULT 'weighted_avg',
    default_settlement_profile VARCHAR(64) NOT NULL DEFAULT 'INSTANT',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (module_code, category, subcategory),
    FOREIGN KEY (module_code) REFERENCES modules(code),
    UNIQUE KEY uk_category_subcategory (category, subcategory)
);

-- Catalogo de metodos de valoracao implementados em codigo (typescript).
-- class_path eh resolvido pelo InventoryValuation factory.
CREATE TABLE module_valuation_methods (
    method_code VARCHAR(64) PRIMARY KEY,
    canonical_name VARCHAR(120) NOT NULL,
    class_path VARCHAR(255) NOT NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Catalogo de perfis de liquidacao (D+N) por tipo de operacao + conta.
-- SettlementEngine usa para calcular settlement_date em financial_ledger_entries.
CREATE TABLE module_settlement_profiles (
    profile_code VARCHAR(64) PRIMARY KEY,
    canonical_name VARCHAR(120) NOT NULL,
    days_offset INT NOT NULL DEFAULT 0,
    business_days_only BOOLEAN NOT NULL DEFAULT TRUE,
    default_status ENUM('pending', 'cleared') NOT NULL DEFAULT 'pending',
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seeds basicas (dado canonico, nao codigo)
INSERT INTO module_valuation_methods (method_code, canonical_name, class_path, description) VALUES
    ('weighted_avg',        'Preco medio ponderado',   'src/core/inventory/valuation/WeightedAverageValuation', 'Custo medio recalculado a cada movimento.'),
    ('three_prices_invest', 'Tres precos (INVEST)',    'src/modules/invest/valuation/ThreePricesValuation',     'PM Estrito / PM B3 / PM Gerencial — opcoes nao tem multiplicador.'),
    ('fifo',                'FIFO',                    'src/core/inventory/valuation/FifoValuation',            'First-in first-out — comum em estoque fisico.'),
    ('lifo',                'LIFO',                    'src/core/inventory/valuation/LifoValuation',            'Last-in first-out.'),
    ('straight_line',       'Depreciacao linear',      'src/core/inventory/valuation/StraightLineValuation',    'Imobilizado e imoveis.');

INSERT INTO module_settlement_profiles (profile_code, canonical_name, days_offset, business_days_only, default_status, description) VALUES
    ('INSTANT', 'Liquidacao imediata',         0,  TRUE,  'cleared', 'Caixa fisico, gateway, transferencias intra-conta.'),
    ('B3_D1',   'B3 D+1',                      1,  TRUE,  'pending', 'Opcoes B3.'),
    ('B3_D2',   'B3 D+2',                      2,  TRUE,  'pending', 'Acoes e FIIs B3.'),
    ('B3_D3',   'B3 D+3',                      3,  TRUE,  'pending', 'Renda fixa B3.'),
    ('NET_30',  'Pagamento em 30 dias',        30, FALSE, 'pending', 'Fornecedores varejo/atacado.'),
    ('NET_60',  'Pagamento em 60 dias',        60, FALSE, 'pending', NULL),
    ('NET_90',  'Pagamento em 90 dias',        90, FALSE, 'pending', NULL);

-- Modulo INVEST domina as subcategorias de ativos financeiros tradicionais.
INSERT INTO module_categories
    (module_code, category, subcategory, canonical_name, default_quantity_unit, default_valuation_method, default_settlement_profile) VALUES
    ('INVEST', 'financial_asset', 'stock',          'Acao',                       'un', 'three_prices_invest', 'B3_D2'),
    ('INVEST', 'financial_asset', 'fii',            'Fundo Imobiliario',          'cota', 'three_prices_invest', 'B3_D2'),
    ('INVEST', 'financial_asset', 'option_call',    'Opcao de compra (CALL)',     'un', 'three_prices_invest', 'B3_D1'),
    ('INVEST', 'financial_asset', 'option_put',     'Opcao de venda (PUT)',       'un', 'three_prices_invest', 'B3_D1'),
    ('INVEST', 'financial_asset', 'fixed_income',   'Renda fixa',                 'un', 'weighted_avg',        'B3_D3'),
    ('INVEST', 'financial_asset', 'etf',            'ETF',                        'cota', 'three_prices_invest', 'B3_D2'),
    ('INVEST', 'financial_asset', 'bdr',            'BDR',                        'un', 'three_prices_invest', 'B3_D2');
