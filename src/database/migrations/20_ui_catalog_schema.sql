-- ==============================================================================
-- CO-CEO PLATFORM | CATALOGO DE UI (texto + menu) + OVERRIDES POR ORGANIZACAO
-- Suporta customizacao por cliente (renomeacao) sem duplicar catalogo;
-- chave estavel reaproveitavel pelo IAM granular (mesma key em access_resources).
-- ver: docs/architecture/ui_catalog.md (a criar)
-- ==============================================================================

-- Catalogo unico de textos da UI: cada chave (text_key + locale) tem um default.
-- Cliente sobrescreve em ui_text_overrides apenas as chaves que quer mudar.
CREATE TABLE ui_text_catalog (
    id VARCHAR(36) PRIMARY KEY,
    text_key VARCHAR(160) NOT NULL,
    locale VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
    module_code VARCHAR(50) NULL,
    kind ENUM(
        'menu_item',
        'screen_title',
        'column_label',
        'field_label',
        'value_label',
        'button_label'
    ) NOT NULL,
    default_text VARCHAR(255) NOT NULL,
    description VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_text_key_locale (text_key, locale),
    INDEX idx_text_module_kind (module_code, kind)
);

-- Overrides do cliente: apenas linhas onde o texto difere do default.
CREATE TABLE ui_text_overrides (
    organization_id VARCHAR(36) NOT NULL,
    text_key VARCHAR(160) NOT NULL,
    locale VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
    text VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, text_key, locale),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    INDEX idx_override_key (text_key, locale)
);

-- Estrutura do menu lateral. Label visivel resolvido via text_key no catalogo.
-- Visibilidade IAM ainda passa por access_resources.resource_key (mesma convencao).
CREATE TABLE ui_menu_nodes (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(80) NOT NULL,
    parent_id VARCHAR(36) NULL,
    module_code VARCHAR(50) NOT NULL,
    path VARCHAR(255) NULL,
    icon VARCHAR(80) NULL,
    order_index INT NOT NULL DEFAULT 0,
    text_key VARCHAR(160) NOT NULL,
    access_resource_key VARCHAR(160) NULL,
    visibility ENUM('all', 'platform_only', 'client_only') NOT NULL DEFAULT 'all',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_menu_code (code),
    INDEX idx_menu_module (module_code, is_active),
    INDEX idx_menu_parent (parent_id, order_index),
    FOREIGN KEY (parent_id) REFERENCES ui_menu_nodes(id) ON DELETE CASCADE
);
