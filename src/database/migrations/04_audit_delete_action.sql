-- Permite auditar DELETE físico em tabelas de vínculo (IAM junction tables).
ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM('INSERT', 'UPDATE', 'SOFT_DELETE', 'DELETE') NOT NULL;
