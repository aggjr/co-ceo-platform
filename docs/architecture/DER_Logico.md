# Diagrama de Entidade-Relacionamento Lógico (DER Canônico)

Este documento representa o modelo de dados relacional canônico do CO-CEO. 
Abaixo está o DER lógico renderizado no padrão da indústria.

```mermaid
erDiagram
    %% ==========================================
    %% NÚCLEO CORE (SAAS E AUTENTICAÇÃO)
    %% ==========================================

    ORGANIZATIONS ||--o{ ORGANIZATIONS : "parent_id (Hierarquia N-Nível)"
    ORGANIZATIONS ||--o{ CONTRACTS : "Assina"
    
    USERS ||--o{ CONTRACTS : "client_manager (Responsável do Cliente)"
    USERS ||--o{ CONTRACTS : "co_ceo_manager (Account Manager)"
    
    CONTRACTS ||--o{ CONTRACT_MODULES : "Possui permissão de"
    MODULES ||--o{ CONTRACT_MODULES : "Libera"
    
    %% ==========================================
    %% MÓDULO INVEST (WEALTH MANAGEMENT)
    %% ==========================================
    
    ORGANIZATIONS ||--o{ INVEST_ASSETS : "Custódia Global (Por CNPJ)"
    INVEST_ASSETS ||--o{ INVEST_LEDGER_ENTRIES : "Recebe lançamentos (Livro-Razão)"
    USERS ||--o{ INVEST_LEDGER_ENTRIES : "Boletador da Ordem"
    
    INVEST_OPTIONS_CHAIN

    %% ==========================================
    %% DICIONÁRIO DE ATRIBUTOS
    %% ==========================================

    ORGANIZATIONS {
        varchar(36) id PK
        varchar(36) parent_id FK
        varchar(255) name
        text path "Materialized Path (Ex: /root/child/)"
        bigint storage_bytes_used
    }

    USERS {
        varchar(36) id PK
        varchar(255) email
        varchar(255) password_hash
        boolean is_active
    }

    CONTRACTS {
        varchar(36) id PK
        varchar(36) organization_id FK
        varchar(36) client_manager_user_id FK
        varchar(36) co_ceo_manager_user_id FK
        enum billing_cycle "monthly, annual"
        enum status "active, trial, suspended"
    }

    MODULES {
        varchar(50) code PK "Ex: CORE, INVEST, CASH"
        varchar(100) name
    }

    CONTRACT_MODULES {
        varchar(36) contract_id PK, FK
        varchar(50) module_code PK, FK
        enum status "active, suspended"
    }

    INVEST_ASSETS {
        varchar(36) id PK
        varchar(36) organization_id FK
        varchar(10) ticker "Ex: PRIO3"
        int total_quantity
        decimal strict_avg_price "Preço Médio Contábil"
        decimal managerial_avg_price "Preço Médio Gerencial (Estratégico)"
    }

    INVEST_LEDGER_ENTRIES {
        varchar(36) id PK
        varchar(36) asset_id FK "Aponta para INVEST_ASSETS"
        varchar(36) user_id FK "Quem operou"
        varchar(50) entry_type "SELL_PUT, DIVIDEND, RENT"
        varchar(10) option_ticker "Ex: PRIOR560"
        decimal gross_amount "Receita Bruta"
        decimal fees_amount "Corretagem/Emolumentos"
        decimal net_amount "Liquidez"
        date operation_date
    }

    INVEST_OPTIONS_CHAIN {
        varchar(10) ticker PK "Ex: PRIOR560"
        varchar(10) underlying_asset "Ex: PRIO3"
        enum type "CALL, PUT"
        decimal strike_price
        decimal last_price
        decimal delta_approx "Usado p/ Cálculo Ampulheta"
        timestamp scraped_at "Data do Robô B3"
    }
```

## Regras de Integridade Relacional (Triggers Lógicos)
1. **Multi-Tenant:** Toda consulta em `INVEST_ASSETS` ou `INVEST_LEDGER_ENTRIES` **deve obrigatoriamente** sofrer *join* com a tabela `ORGANIZATIONS` verificando o `path` do nó ativo.
2. **Cálculo de Preço Médio:** O campo `managerial_avg_price` na tabela `INVEST_ASSETS` não deve ser alterado manualmente. Ele é o resultado da divisão algébrica do estoque total pelo somatório dos `net_amount` na tabela `INVEST_LEDGER_ENTRIES`.
3. **Isolamento de Cache:** A tabela `INVEST_OPTIONS_CHAIN` é agnóstica de organização. O robô noturno popula ela globalmente para reduzir gargalos de processamento.
