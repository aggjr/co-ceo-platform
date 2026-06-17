-- Kind canonico para operacoes de Tesouro Direto vindas do extrato BTG (header BTG-TD:{date}:{ticker}).
-- Nao altera policies de buy/sell — o kind do header e inferido em runtime (inferBusinessEventKind).

INSERT INTO invest_operation_types (operation_code, canonical_name, description)
VALUES (
  'treasury_direct_buy',
  'Compra TD via extrato',
  'Legado/documentacao — use buy + event_source_ref BTG-TD:*'
)
ON DUPLICATE KEY UPDATE canonical_name = VALUES(canonical_name);
