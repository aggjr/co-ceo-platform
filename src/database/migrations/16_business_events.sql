-- ==============================================================================
-- CO-CEO PLATFORM | BUSINESS EVENTS - elo canonico entre custodia e caixa
-- ver: docs/architecture/nucleo_patrimonial.md
-- ==============================================================================
-- Um "evento de negocio" eh o fato gerador que liga as pernas:
--   * patrimony_ledger_entries (N pernas de estoque/custodia)
--   * financial_ledger_entries (1..N pernas de caixa, com D+N de liquidacao)
--
-- Exemplo INVEST: nota BTG #12345 (17/04/2026)
--   business_event(kind='broker_note_option', occurred_on=17/04, settles_on=18/04,
--                  source_ref='12345', total_net=-821929.04)
--     -> patrimony_ledger(buy 5400 PRIO3) + patrimony_ledger(exercise PRIOR407) + ...
--     -> financial_ledger(out 821929.04 em 22/04 = D+1util)
--
-- Exemplo STOCKSPIN futuro: NFe 67890 (compra de 1000 unidades)
--   business_event(kind='inventory_purchase', occurred_on=10/06, settles_on=10/07,
--                  source_ref='67890', total_net=-50000)
--     -> patrimony_ledger(in 1000 SKU-XYZ)
--     -> financial_ledger(out 50000 em 10/07 = boleto)
--
-- Imutabilidade: business_events fechado NUNCA sofre UPDATE de campos de
-- negocio. Correcao = NOVO header (revision_no=2) com supersedes_event_id
-- apontando o anterior. Audit_log do gateway captura o resto.

CREATE TABLE business_events (
    id                   VARCHAR(36) PRIMARY KEY,
    organization_id      VARCHAR(36) NOT NULL,
    source_module        VARCHAR(50) NOT NULL,
    event_kind           VARCHAR(50) NOT NULL,
    occurred_on          DATE NOT NULL,
    settles_on           DATE NULL,
    source_ref           VARCHAR(128) NULL,
    counterparty         VARCHAR(255) NULL,
    total_gross          DECIMAL(18, 4) NOT NULL DEFAULT 0,
    total_costs          DECIMAL(18, 4) NOT NULL DEFAULT 0,
    total_net            DECIMAL(18, 4) NOT NULL DEFAULT 0,
    -- proveniencia (sem armazenar o documento; so o RASTRO)
    source_system        VARCHAR(80) NOT NULL,
    source_version       VARCHAR(40) NULL,
    recorded_by_user_id  VARCHAR(36) NULL,
    recorded_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- revisao
    revision_no          INT NOT NULL DEFAULT 1,
    supersedes_event_id  VARCHAR(36) NULL,
    voided_at            TIMESTAMP NULL,
    voided_by_user_id    VARCHAR(36) NULL,
    void_reason          VARCHAR(500) NULL,
    metadata             JSON NULL,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at           TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (source_module) REFERENCES modules(code),
    FOREIGN KEY (supersedes_event_id) REFERENCES business_events(id),
    UNIQUE KEY uk_event_org_module_ref_rev (organization_id, source_module, source_ref, revision_no),
    INDEX idx_event_org_date (organization_id, occurred_on),
    INDEX idx_event_org_settles (organization_id, settles_on),
    INDEX idx_event_org_kind (organization_id, event_kind)
);

-- Perna de custodia/estoque aponta para o evento
ALTER TABLE patrimony_ledger_entries
    ADD COLUMN business_event_id VARCHAR(36) NULL,
    ADD CONSTRAINT fk_patrimony_event
        FOREIGN KEY (business_event_id) REFERENCES business_events(id),
    ADD INDEX idx_patrimony_event (business_event_id);

-- Perna de caixa aponta para o evento
ALTER TABLE financial_ledger_entries
    ADD COLUMN business_event_id VARCHAR(36) NULL,
    ADD CONSTRAINT fk_financial_event
        FOREIGN KEY (business_event_id) REFERENCES business_events(id),
    ADD INDEX idx_financial_event (business_event_id);
