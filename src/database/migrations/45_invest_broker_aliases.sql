-- Migration 45: Invest Broker Aliases

CREATE TABLE IF NOT EXISTS invest_broker_aliases (
  alias_name VARCHAR(180) NOT NULL,
  broker_code VARCHAR(80) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (alias_name),
  CONSTRAINT fk_iba_broker
    FOREIGN KEY (broker_code) REFERENCES invest_brokers(broker_code)
    ON DELETE CASCADE
);

-- Seeds
INSERT INTO invest_broker_aliases (alias_name, broker_code)
VALUES
  ('BTG', 'BTG'),
  ('BTG PACTUAL', 'BTG'),
  ('XP', 'XP'),
  ('XP INVESTIMENTOS', 'XP'),
  ('CLEAR', 'CLEAR'),
  ('CLEAR CORRETORA', 'CLEAR'),
  ('NECTON', 'NECTON_BTG'),
  ('IBKR', 'INTERACTIVE_BROKERS'),
  ('INTERACTIVE BROKERS', 'INTERACTIVE_BROKERS'),
  ('BINANCE', 'BINANCE')
ON DUPLICATE KEY UPDATE broker_code = VALUES(broker_code);
