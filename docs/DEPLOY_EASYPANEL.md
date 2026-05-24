# Deploy no EasyPanel — `co_ceo_platform` (V0.0.32+)

Guia para subir a API + frontend e um **MySQL novo** com schema `co_ceo_platform` (sem colidir com `co_ceo_db` legado no mesmo servidor).

## 1. MySQL no EasyPanel

1. **Services → Add Service → MySQL** (8.x).
2. Anote no painel do serviço:
   - Host interno (ex.: `mysql` ou `co-ceo-mysql`)
   - Porta (geralmente `3306`)
   - Usuário e senha root/app
3. Crie o database **`co_ceo_platform`** (phpMyAdmin, Adminer ou CLI):

```sql
CREATE DATABASE IF NOT EXISTS co_ceo_platform
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 2. Importar dados (dump do repo)

O arquivo `database/dumps/co_ceo_db_full_export.sql` foi gerado com o nome `co_ceo_db`. Use o script que renomeia para o schema alvo:

**Na sua máquina** (com `.env` apontando para o MySQL do EasyPanel — host público ou túnel):

```bash
# .env
DB_HOST=<host-do-mysql-easypanel>
DB_USER=<user>
DB_PASSWORD=<senha>
DB_NAME=co_ceo_platform

node scripts/import-full-dump.js
```

**Ou** no terminal do container MySQL / one-off job com o repo clonado e as mesmas variáveis.

> O dump contém senhas hasheadas e dados reais. Não exponha publicamente.

## 3. App Node (API + UI)

1. **Services → Add Service → App** (`co-ceo-platform`)
2. **Fonte → Github:** `aggjr` / `co-ceo-platform` / ramo `feat/invest-custody-validation-2026-05` / caminho `/`
3. **Construção → Dockerfile:** arquivo `Dockerfile` na raiz (commitado no Git)
4. **Porta do container:** `3001` (o EasyPanel mapeia para HTTPS; o app também lê `PORT` se injetado)
5. **Health check (recomendado):** path `/health` — deve retornar `database: connected` após o MySQL estar importado.

> Com Dockerfile não é necessário preencher build/start command no painel — o `docker build` usa o `Dockerfile`.

### Variáveis de ambiente (app)

| Variável | Exemplo / notas |
|----------|------------------|
| `DB_HOST` | Host **interno** do serviço MySQL no EasyPanel |
| `DB_USER` | Usuário MySQL |
| `DB_PASSWORD` | Senha |
| `DB_NAME` | `co_ceo_platform` |
| `JWT_SECRET` | String longa aleatória (nova em produção invalida tokens antigos) |
| `CO_CEO_ADMIN_EMAIL` | `admin@coceo.com.br` |
| `CO_CEO_ADMIN_PASSWORD` | Só se for rodar seed; com dump importado o admin já existe |
| `PORTFOLIO_ORG_ID` | `org-holding-001` |
| `BRAPI_TOKEN` | Opcional — cotações B3 |
| `NODE_ENV` | `production` (opcional) |

Conecte o app ao MySQL pela rede interna do EasyPanel (não use `localhost` no app se o MySQL for outro serviço).

## 4. Deploy / atualizar versão

1. Push na branch configurada no EasyPanel.
2. **Redeploy** no painel (ou webhook automático).
3. Confirme versão: `GET https://<seu-dominio>/api/version` → `V0.0.32`.

## 5. Cron INVEST (opções.net)

O container **não usa crontab do host** — o agendamento roda **dentro do processo Node** após o deploy (sem `ts-node`).

| Variável | Padrão | Função |
|----------|--------|--------|
| `INVEST_CRON_ENABLED` | `1` em `NODE_ENV=production` | `0` desliga; `1` força em dev |
| `INVEST_CRON_TZ` | `America/Sao_Paulo` | Fuso do horário |
| `INVEST_CRON_OPTIONS_AT` | `03:15` | Strike/vencimento via opcoes.net → `invest_options_market` |
| `INVEST_CRON_RUN_ON_STARTUP` | — | `1` roda uma vez ao subir o container (útil após deploy) |

Logs no painel do app: `[cron] options-market — iniciando/concluído`.

**Alertas na UI (sem olhar log):** usuário com escopo **global** (equipe co-CEO) vê faixa no topo quando um job falha ou gera aviso. Requer migration `25_platform_job_monitoring.sql`.

```bash
# aplicar migration no MySQL de produção (uma vez)
mysql -h ... -u ... -p co_ceo_platform < src/database/migrations/25_platform_job_monitoring.sql
```

Manual (máquina com repo + `REMOTE_DB_*` ou túnel):

```bash
npm run sync:options:market
```

## 6. Checklist pós-deploy

- [ ] `GET /health` → `OK`, `database: connected`
- [ ] Login com usuário do dump (ex. admin da holding)
- [ ] `/invest/portfolio` carrega sem 500
- [ ] `JWT_SECRET` definido e não commitado no Git

## 7. Problemas comuns

| Sintoma | Causa provável |
|---------|----------------|
| `database: disconnected` | `DB_HOST` errado, firewall, ou DB ainda não importado |
| Frontend 404 / “não compilado” | Build falhou; ver logs do `npm run build` |
| Login ok mas invest vazio | Dump não importado ou `DB_NAME` ≠ `co_ceo_platform` |
| App usa `co_ceo_db` | `DB_NAME` não setado no EasyPanel |

## Referência local

```bash
npm install
cp .env.example .env
# preencher DB_* para o MySQL do EasyPanel
node scripts/import-full-dump.js
npm run build && npm start
```
