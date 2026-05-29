# CONC-05 — Catálogo UI, menu e deploy

> **ID:** CONC-05 · **Depende de:** CONC-02, CONC-04  
> **Spec mestre:** [`docs/architecture/invest_conciliacao.md`](../../docs/architecture/invest_conciliacao.md)

## 1. Objetivo

Registrar menus, textos, `access_resources`, migração menu DB, verificar versão UI após ship.

## 2. Arquivos

- `src/database/seeds/008_ui_catalog.ts`
- `src/database/migrations/34_ui_conciliacao_menu.sql` (criar — itens menu conciliação)
- `scripts/version-ui-surfaces.json` (se novas superfícies)

## 3. Critério de aceite

```bash
npm run verify:version-ui
npx tsc --noEmit
```

Menu INVEST mostra: Conciliação Bancária, Conciliação de Ativos (sem importação legada).
