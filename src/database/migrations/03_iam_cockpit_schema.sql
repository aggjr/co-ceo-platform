-- ==============================================================================
-- CO-CEO PLATFORM | IAM + Cockpit (RBAC, UI, contrato-equipe)
-- Executar após 00_core_saas_schema.sql e 02_gateway_storage_and_meter.sql
-- ==============================================================================

-- Papéis (plataforma ou organização)
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(100) NOT NULL,
    scope ENUM('global', 'node') NOT NULL,
    owner_organization_id VARCHAR(36) NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    description VARCHAR(255) NULL,
    perm_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (owner_organization_id) REFERENCES organizations(id),
    UNIQUE KEY uk_role_code_owner (code, owner_organization_id)
);

-- Catálogo de permissões atômicas (API / ações)
CREATE TABLE permissions (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(120) NOT NULL UNIQUE,
    module VARCHAR(50) NOT NULL,
    resource VARCHAR(50) NOT NULL,
    action VARCHAR(30) NOT NULL,
    description VARCHAR(255) NULL,
    audience ENUM('platform', 'organization', 'both') NOT NULL DEFAULT 'both',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE role_permissions (
    role_id VARCHAR(36) NOT NULL,
    permission_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- Usuários vinculados ao contrato comercial
CREATE TABLE contract_users (
    contract_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    default_organization_id VARCHAR(36) NOT NULL,
    status ENUM('active', 'invited', 'suspended') NOT NULL DEFAULT 'active',
    invited_by_user_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (contract_id, user_id),
    FOREIGN KEY (contract_id) REFERENCES contracts(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (default_organization_id) REFERENCES organizations(id)
);

-- Contexto: usuário + papel + contrato + nó na árvore
CREATE TABLE user_roles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    contract_id VARCHAR(36) NULL,
    organization_id VARCHAR(36) NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    granted_by_user_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    INDEX idx_user_roles_user (user_id),
    INDEX idx_user_roles_contract (contract_id)
);

-- Catálogo de telas, rotas, botões (Cockpit + módulos)
CREATE TABLE access_resources (
    id VARCHAR(36) PRIMARY KEY,
    resource_key VARCHAR(160) NOT NULL UNIQUE,
    resource_type ENUM('module', 'screen', 'route', 'button', 'api') NOT NULL,
    module_code VARCHAR(50) NULL,
    parent_resource_key VARCHAR(160) NULL,
    label VARCHAR(255) NOT NULL,
    description VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE role_resource_grants (
    role_id VARCHAR(36) NOT NULL,
    resource_id VARCHAR(36) NOT NULL,
    effect ENUM('allow', 'deny') NOT NULL DEFAULT 'allow',
    PRIMARY KEY (role_id, resource_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (resource_id) REFERENCES access_resources(id) ON DELETE CASCADE
);

-- Auditoria de configuração IAM (visível para co-CEO e admin cliente)
CREATE TABLE iam_config_audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    contract_id VARCHAR(36) NULL,
    organization_id VARCHAR(36) NULL,
    actor_user_id VARCHAR(36) NOT NULL,
    impersonator_user_id VARCHAR(36) NULL,
    change_type VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(36) NOT NULL,
    old_payload JSON NULL,
    new_payload JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_iam_audit_contract (contract_id),
    INDEX idx_iam_audit_org (organization_id)
);

-- FK em field_permissions.role_id (tabela já existe no core)
ALTER TABLE field_permissions
  ADD CONSTRAINT fk_field_permissions_role
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
