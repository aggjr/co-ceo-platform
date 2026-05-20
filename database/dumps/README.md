# Dump completo — `co_ceo_db`

Arquivo: **`co_ceo_db_full_export.sql`** (~4 MB)

Contém **100%** do banco atual:

- `DROP DATABASE` + `CREATE DATABASE co_ceo_db`
- Estrutura de todas as tabelas
- Dados (`INSERT`) — IAM, contratos, invest_assets, invest_ledger_entries, etc.
- Charset `utf8mb4`

Gerado com `mysqldump` em 2026-05-20 a partir do MySQL local (`.env`).

## Importar em outro servidor (MySQL 8+)

```bash
mysql -u root -p < database/dumps/co_ceo_db_full_export.sql
```

Windows (PowerShell):

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < database\dumps\co_ceo_db_full_export.sql
```

Ou use o script:

```powershell
.\scripts\db-import-full.ps1
```

## Regenerar o dump (origem atualizada)

```powershell
.\scripts\db-export-full.ps1
```

Lê `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` do `.env` na raiz do projeto.

## Após importar no servidor novo

1. Ajuste `.env` do app: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=co_ceo_db`
2. `JWT_SECRET` pode ser o mesmo ou novo (tokens antigos invalidam se mudar)
3. Suba API + frontend: `npm run dev`

## Segurança

O dump inclui **hashes de senha** e dados reais da holding. Não publique em repositório público sem revisão; neste repo é uso interno.
