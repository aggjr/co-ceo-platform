# Criar MySQL `co_ceo_platform` no EasyPanel

Use **uma** das opções.

## Opção A — Reutilizar `co-ceo-db` (recomendado)

1. Abra o serviço **co-ceo-db** no projeto `co_ceo`.
2. Entre em **phpMyAdmin**, **Adminer** ou **Terminal**.
3. Execute:

```sql
CREATE DATABASE IF NOT EXISTS co_ceo_platform
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

4. No painel do **co-ceo-db**, copie:
   - Host interno (para o app → `DB_HOST_INTERNAL`)
   - Host público / porta (para importar da sua máquina → `DB_HOST`)
   - Usuário e senha root ou do app

5. Em `config/deploy-credentials.env`:
   - `DB_SKIP=nao`
   - Preencha `DB_HOST`, `DB_HOST_INTERNAL`, `DB_USER`, `DB_PASSWORD`
   - `DB_ALREADY_CREATED=sim`

## Opção B — MySQL novo no EasyPanel

1. **+ Serviço** → **MySQL** 8.x (ex.: nome `co-ceo-platform-db`).
2. Anote usuário/senha gerados pelo EasyPanel.
3. Crie o database `co_ceo_platform` (SQL acima).
4. Preencha FASE 2 em `deploy-credentials.env` com os hosts desse serviço.

## Depois

Avise no chat. O assistente importa o dump e valida `/health`.
