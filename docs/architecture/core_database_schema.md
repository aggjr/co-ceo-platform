# co-CEO Core — Modelagem de Banco de Dados (Schema SQL)

Este documento define a estrutura relacional do núcleo da plataforma (Autenticação, Multi-tenant Hierárquico, RBAC e Auditoria Detalhada).

> **Nota de Design:** O schema evoluiu para suportar **N-Níveis Hierárquicos (Árvore Infinita)**.
> Em vez de engessar o sistema em "Tenant -> Grupo -> Loja", adotamos o padrão **Materialized Path**. 
> 1. **Global:** Acesso total sem restrição de nó (Equipe co-CEO).
> 2. **Nó de Organização (N-Depth):** O usuário recebe acesso a um nó na árvore. O sistema concede acesso àquele nó e a **todos os seus descendentes**, não importa se há 2 ou 50 níveis abaixo dele (ideal para Marketing Multinível, Matrizes Complexas ou Regionais).

---

## Estrutura SQL

```sql
-- Extensão para UUIDs (se usando PostgreSQL) ou VARCHAR(36) no MySQL
-- Assumiremos MySQL/MariaDB com VARCHAR(36) para UUIDs por compatibilidade com a stack legada.

-- 1. ESTRUTURA HIERÁRQUICA INFINITA (MATERIALIZED PATH)
-- Cada Unidade Organizacional (OU) representa um ponto na hierarquia.

CREATE TABLE organizations (
    id VARCHAR(36) PRIMARY KEY,
    parent_id VARCHAR(36) NULL,           -- Se NULL, é a Raiz (Ex: A Marca / Franqueador Máximo)
    name VARCHAR(255) NOT NULL,           -- Nome da unidade
    type VARCHAR(50) NOT NULL,            -- Ex: 'holding', 'franchisor', 'factory', 'store', 'department'
    document VARCHAR(50),                 -- CNPJ/CPF opcional
    
    -- O "Pulo do Gato" para performance em N-Níveis: Materialized Path
    -- Guarda o caminho completo do nó. Ex: "/root_id/node1_id/node2_id/"
    -- Permite consultas ultrarrápidas de descendentes usando LIKE.
    path TEXT NOT NULL,                   
    
    -- Customização Visual e de Interface (White-label por OU)
    branding_json JSON,                   -- Ex: {"primary_color": "#ff0000", "logo_url": "https..."}
    ui_overrides_json JSON,               -- Ex: {"menu_cash": "Financeiro", "field_sku": "Código Interno"}
    
    -- Hodômetro de Banco de Dados (Atualizado pelo DataWrapper em tempo real)
    storage_bytes_used BIGINT DEFAULT 0,  -- Tamanho real consumido
    plan_storage_limit_bytes BIGINT,      -- Limite do plano (NULL = ilimitado)
    
    status ENUM('active', 'suspended', 'closed') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (parent_id) REFERENCES organizations(id) ON DELETE RESTRICT
);

-- 2. IDENTIDADE E USUÁRIOS

CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    recovery_email VARCHAR(255) NULL,     -- E-mail alternativo para resgate de senha
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    preferred_name VARCHAR(100),          -- Útil para a IVA/Personas
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. RBAC (ROLE-BASED ACCESS CONTROL)

CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,           -- Ex: "Super Admin", "Network Owner", "Node Manager"
    scope ENUM('global', 'node') NOT NULL, -- O escopo agora é absoluto (global) ou relativo a um Nó (node)
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
    id VARCHAR(36) PRIMARY KEY,
    module VARCHAR(50) NOT NULL,          -- Ex: "core", "cash", "stockspin"
    code VARCHAR(100) UNIQUE NOT NULL,    -- Ex: "cash:incomes:write", "core:impersonate:execute"
    description VARCHAR(255)
);

CREATE TABLE role_permissions (
    role_id VARCHAR(36) NOT NULL,
    permission_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- 4. O VÍNCULO MÁGICO (USUÁRIO + ROLE + CONTEXTO)

CREATE TABLE user_roles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    
    -- O contexto N-Nível onde a Role se aplica
    organization_id VARCHAR(36) NULL,           
    
    -- REGRAS LÓGICAS (Validadas pelo Wrapper):
    -- Se scope = 'global', organization_id DEVE ser NULL. (Equipe co-CEO).
    -- Se scope = 'node', organization_id DEVE ser preenchido. O usuário ganha acesso a este Nó e todos os seus filhos.

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- 5. TRILHA DE AUDITORIA (AUDIT LOG / CDC)

CREATE TABLE audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, 
    
    -- Onde aconteceu
    table_name VARCHAR(100) NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    action ENUM('INSERT', 'UPDATE', 'DELETE', 'SOFT_DELETE') NOT NULL,
    
    -- Contexto Operacional (Onde na árvore isso ocorreu)
    organization_id VARCHAR(36) NULL,
    
    -- Quem fez (O pulo do gato do Impersonation)
    actor_user_id VARCHAR(36) NOT NULL,        -- O usuário que a ação representa
    impersonator_user_id VARCHAR(36) NULL,     -- O Super Admin que emulou o usuário (se for o caso)
    
    -- O que mudou
    old_payload JSON NULL,                     -- Estado anterior
    new_payload JSON NULL,                     -- Novo estado
    
    -- Rastreabilidade Técnica
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Índices para relatórios rápidos de auditoria
    INDEX idx_audit_record (table_name, record_id),
    INDEX idx_audit_org (organization_id),
    INDEX idx_audit_actor (actor_user_id)
);

-- 6. TELEMETRIA E LOGS DE COMPORTAMENTO (ALIMENTAÇÃO DA IA)

CREATE TABLE telemetry_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    user_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    impersonator_user_id VARCHAR(36) NULL, -- Se a ação foi feita via emulação
    
    event_type VARCHAR(50) NOT NULL,       -- Ex: 'screen_view', 'button_click', 'module_accessed', 'report_exported'
    event_name VARCHAR(100) NOT NULL,      -- Ex: 'cash_dashboard', 'generate_dre', 'stock_adjustment'
    
    -- Contexto rico para a Inteligência Artificial
    metadata JSON NULL,                    -- Ex: {"time_spent_seconds": 120, "filters_applied": ["data", "filial"]}
    
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Otimizado para análise da IA em grandes volumes
    INDEX idx_telemetry_org (organization_id),
    INDEX idx_telemetry_user (user_id),
    INDEX idx_telemetry_event (event_name)
);

-- 7. GESTÃO DE MÓDULOS E LICENCIAMENTO (O QUE O CLIENTE COMPROU)

CREATE TABLE modules (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,      -- 'CASH', 'STOCKSPIN', 'PEOPLE', 'AI_COPILOT'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE ou_modules (
    organization_id VARCHAR(36) NOT NULL,
    module_code VARCHAR(50) NOT NULL,
    
    -- Controle Financeiro e Bloqueios
    status ENUM('active', 'suspended', 'trial') DEFAULT 'active',
    trial_ends_at TIMESTAMP NULL,
    
    PRIMARY KEY (organization_id, module_code),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (module_code) REFERENCES modules(code) ON DELETE CASCADE
);
```

## Como isso resolve o problema de Organismos Vivos (N-Níveis)?

A abordagem de **Materialized Path** em uma única tabela `organizations` significa que não há limites de profundidade. 

1. **A Estrutura Dinâmica:**
   - Nó 1: Marca Matriz (`path: /node1/`)
   - Nó 2: Regional Sul (`path: /node1/node2/`)
   - Nó 3: Franqueado João (`path: /node1/node2/node3/`)
   - Nó 4: Loja do João A (`path: /node1/node2/node3/node4/`)
   - Nó 5: Parceiro MMN da Loja A (`path: /node1/node2/node3/node4/node5/`)

2. **A Mágica no Wrapper:** Se o usuário recebe acesso ao "Franqueado João" (Nó 3), o nosso Wrapper no backend executa uma consulta simples na base de dados: `WHERE path LIKE '/node1/node2/node3/%'`. 
   - Instantaneamente, o usuário enxerga a loja dele e qualquer sub-nó que ele criar no futuro (como parceiros MMN), mas é bloqueado de ver a Regional Sul ou a Matriz.

3. **Evolução Contínua:** Se a empresa decidir criar um novo nível "Sub-Regional" amanhã, nenhuma tabela do banco de dados precisa ser alterada. Basta inserir o nó na árvore. Essa é a arquitetura estado da arte usada por gigantes como AWS (IAM Orgs) e Google Cloud (Resource Manager).
