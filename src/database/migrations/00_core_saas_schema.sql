-- ==============================================================================
-- CO-CEO PLATFORM | CORE SAAS SCHEMA (V2 - ENTERPRISE GRADE)
-- ==============================================================================

-- 1. ORGANIZATIONS (Tenants e Sub-Tenants)
CREATE TABLE organizations (
    id VARCHAR(36) PRIMARY KEY,
    parent_id VARCHAR(36),
    name VARCHAR(255) NOT NULL,
    type ENUM('holding', 'company', 'family_office', 'branch') NOT NULL,
    path VARCHAR(1000) NOT NULL, -- Materialized Path (ex: /org-1/org-2/)
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL, -- SOFT DELETE
    FOREIGN KEY (parent_id) REFERENCES organizations(id) ON DELETE RESTRICT
);

-- 2. USERS (Identidades Globais)
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    recovery_email VARCHAR(255) NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    preferred_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    must_change_password BOOLEAN DEFAULT FALSE, -- Flag de segurança para primeiro login
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL -- SOFT DELETE
);

-- 3. MODULES (Catálogo de Produtos CO-CEO)
CREATE TABLE modules (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL, -- ex: 'CORE', 'INVEST', 'CASH', 'STOCKSPIN'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. CONTRACTS (Aperto de Mão Comercial)
CREATE TABLE contracts (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL, -- O cliente pagante
    client_manager_user_id VARCHAR(36) NOT NULL, -- O 'Pai' ou gestor do cliente
    co_ceo_manager_user_id VARCHAR(36) NOT NULL, -- O Account Manager do CO-CEO
    contract_start_date DATE NOT NULL,
    contract_end_date DATE NULL,
    status ENUM('active', 'canceled', 'trial') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL, -- SOFT DELETE
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (client_manager_user_id) REFERENCES users(id),
    FOREIGN KEY (co_ceo_manager_user_id) REFERENCES users(id)
);

-- 5. CONTRACT_MODULES (A Catraca do Paywall)
CREATE TABLE contract_modules (
    contract_id VARCHAR(36) NOT NULL,
    module_code VARCHAR(50) NOT NULL,
    status ENUM('active', 'suspended') DEFAULT 'active',
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contract_id, module_code),
    FOREIGN KEY (contract_id) REFERENCES contracts(id),
    FOREIGN KEY (module_code) REFERENCES modules(code)
);

-- 6. FIELD LEVEL SECURITY (Controle de Acesso por Campo)
CREATE TABLE field_permissions (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL, -- Referência futura para tabela de roles
    table_name VARCHAR(100) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    permission_type ENUM('read', 'write', 'hidden', 'mask') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- 7. CUSTOM FIELD LABELS (White-labeling de Campos)
CREATE TABLE custom_field_labels (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    custom_label VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY org_table_field (organization_id, table_name, field_name)
);

-- 8. AUDIT LOGS (O Rastro Indestrutível)
CREATE TABLE audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id VARCHAR(255) NOT NULL,
    action ENUM('INSERT', 'UPDATE', 'SOFT_DELETE') NOT NULL,
    organization_id VARCHAR(36) NULL, -- Null se for alteração global do CO-CEO
    actor_user_id VARCHAR(36) NOT NULL, -- Quem apertou o botão
    impersonator_user_id VARCHAR(36) NULL, -- Se o CO-CEO estava logado como o cliente
    old_payload JSON NULL,
    new_payload JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_record (table_name, record_id),
    INDEX idx_audit_org (organization_id)
);
