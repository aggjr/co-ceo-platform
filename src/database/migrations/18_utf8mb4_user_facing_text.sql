-- 18_utf8mb4_user_facing_text.sql
-- Forca utf8mb4 nas colunas de texto exibidas na UI (e em IDs naturais),
-- para evitar mojibake do tipo "Gon³alves" no nome da Holding.
--
-- A migration 00_core_saas_schema.sql nao declarou DEFAULT CHARSET nas
-- tabelas; em servidores MySQL onde character_set_server = latin1, as
-- colunas herdam latin1 e bytes utf8 inseridos viram texto corrompido.
--
-- Esta migration eh cirurgica (so colunas user-facing) para minimizar risco.
-- Caso seja preciso uma conversao global, fazer outra migration com
-- ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4 nas tabelas inteiras.

ALTER TABLE organizations
  MODIFY COLUMN name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE users
  MODIFY COLUMN full_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN preferred_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

-- Names em catalog tabs (modules, roles, permissions) tambem.
ALTER TABLE modules
  MODIFY COLUMN name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

ALTER TABLE roles
  MODIFY COLUMN name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN description VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

ALTER TABLE permissions
  MODIFY COLUMN description VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
