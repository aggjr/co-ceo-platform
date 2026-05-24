# Task 01 — Paridade de mercado (visão do usuário)

## Objetivo

Testes que validem **o que o usuário vê** (cotação, strike, vencimento), não apenas se a API respondeu 200.

## Critério de aceite

```bash
npm run test:catalog:sync
npm run test:parity
npx tsc --noEmit
```

Com `BRAPI_TOKEN` e `PARITY_LIVE_MARKET=1`:

```bash
npm run test:parity:live
```

## Escopo

- `tests/parity/**` — brapi (ações) e opcoes.net (fixture + parser)
- `tests/coverage-policy.json` — unidade `invest.market-parity` ativa, metas `proportional: true`
- `invest` lifecycle `active` (gate de regressão)
- Fuzzer: dedup de sementes por payload, cap proporcional aos endpoints

## Fora de escopo

- E2E Playwright na carteira (task futura)
- Scraping opcoes.net ao vivo sem API estável (usar fixture + job de sync em prod)
