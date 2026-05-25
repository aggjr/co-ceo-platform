# Snapshot de custódia homebroker (INVEST)

Referência capturada na corretora **não vive em código TypeScript**. Fluxo canônico:

```
JSON local (local-import/)  →  import  →  MySQL  →  apply  →  livro / cotações / âncoras
```

## Tabelas (por `organization_id`)

| Tabela | Conteúdo |
|--------|----------|
| `invest_broker_custody_snapshots` | Cabeçalho: data, corretora, composição patrimonial |
| `invest_broker_custody_snapshot_lines` | Posições: marcas de mercado e linhas pendentes de nota |

## Formato JSON (`schemaVersion: 1`)

Ver `docs/invest/broker-custody-snapshot.template.json` e fixture de teste
`tests/fixtures/broker-custody-snapshot-btg-2026-05-23.json`.

| `lineKind` | Uso |
|------------|-----|
| `mark` | Cotação + `current_value` em `patrimony_items` |
| `pending_open` | Lançamento provisório no livro (opção ausente) |
| `pending_topup` | Complemento de quantidade |
| `pending_migrate` | Troca de ticker (ex. WEGER41 → WEGER441) |

## Comandos

```bash
# 1) Coloque o JSON em local-import/btg-sources/ (não vai ao Git)
npm run import:broker:snapshot -- local-import/btg-sources/custody-snapshot.json

# 2) Aplica marcas e âncoras
npm run apply:broker:snapshot -- 2026-05-23

# 3) Lançamentos provisórios (se houver pending_* no JSON)
npm run apply:broker:options-ledger -- 2026-05-23

# Strikes / vencimento (catálogo global, sem hardcode)
npm run sync:options:market -- PRIO3 ITUB4 BBAS3 WEGE3
```

## Runtime (UI / API)

- **Custódia e CALLs vendidas:** `invest_ledger_entries` + projeção `patrimony_items`
- **Strike / notional:** `invest_options_market` (opcoes.net) + metadata do livro
- **Patrimônio diário:** `invest_portfolio_daily` + âncoras `invest_patrimony_monthly_anchors`

Nenhum array de tickers/preços em `src/core/invest/*.ts`.
