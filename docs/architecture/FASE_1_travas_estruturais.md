# TASK FASE 1 — Travas Estruturais: businessEventId obrigatório nos ledgers

**Documento base:** `docs/architecture/invest_reconciliacao_plano_rigido_eventos.md`
**Pré-requisito:** Fase 0 concluída — `npm run build` passando.
**Objetivo:** Tornar impossível gravar perna patrimonial ou financeira sem `business_event_id`.

---

## Contexto

O princípio central do plano é: toda alteração tem uma explicação de negócio registrada em `business_events`. Hoje os ledgers aceitam pernas sem `business_event_id`. Esta task instala as travas que impedem isso.

**Ordem obrigatória dentro desta task:**
1. Adaptar `InventoryLedger.recordMovement`
2. Adaptar `FinancialLedger.record`
3. Adaptar todos os callers de ambos
4. Garantir `InvestOperations.recordOperation` sempre cria ou recebe evento
5. Adicionar auditoria que detecta pernas órfãs
6. Build + testes

**NÃO aplicar `NOT NULL` no banco ainda** — só depois que dados históricos forem limpos na Fase 6.

---

## Arquivo 1 — `src/core/inventory/InventoryLedger.ts`

### Mudar a assinatura de `recordMovement`

Localizar o método `recordMovement` (ou equivalente que grava em `patrimony_ledger_entries`).

Antes:
```typescript
async recordMovement(
  ctx: UserContext,
  payload: {
    patrimonyItemId: string;
    transactionType: string;
    quantity: number;
    unitPrice: number;
    totalNetValue: number;
    transactionDate: string;
    // ... outros campos
    businessEventId?: string; // ← opcional hoje
  }
): Promise<string>
```

Depois:
```typescript
async recordMovement(
  ctx: UserContext,
  payload: {
    patrimonyItemId: string;
    transactionType: string;
    quantity: number;
    unitPrice: number;
    totalNetValue: number;
    transactionDate: string;
    // ... outros campos
    businessEventId: string; // ← OBRIGATÓRIO — sem opcional
  }
): Promise<string>
```

Adicionar guarda no início do método:
```typescript
async recordMovement(ctx: UserContext, payload: InventoryMovementPayload): Promise<string> {
  if (!payload.businessEventId) {
    throw new GatewayError(
      'MISSING_BUSINESS_EVENT',
      `recordMovement requer businessEventId. Tipo: ${payload.transactionType}, ativo: ${payload.patrimonyItemId}`,
      400
    );
  }
  // ... resto do método igual
}
```

---

## Arquivo 2 — `src/core/financial/FinancialLedger.ts`

### Mudar a assinatura de `record`

Mesma abordagem:

```typescript
async record(
  ctx: UserContext,
  payload: {
    accountId: string;
    transactionType: string;
    amount: number;
    direction: 'inflow' | 'outflow';
    transactionDate: string;
    settlementDate: string;
    status: 'pending' | 'cleared' | 'cancelled';
    businessEventId: string; // ← OBRIGATÓRIO
    // ... outros campos
  }
): Promise<string> {
  if (!payload.businessEventId) {
    throw new GatewayError(
      'MISSING_BUSINESS_EVENT',
      `FinancialLedger.record requer businessEventId. Conta: ${payload.accountId}, tipo: ${payload.transactionType}`,
      400
    );
  }
  // ... resto igual
}
```

---

## Arquivo 3 — Atualizar todos os callers

Executar para encontrar todos os callers:
```bash
grep -rn "recordMovement\|FinancialLedger.*record\b" src/ --include="*.ts" \
  | grep -v "\.test\." | grep -v "node_modules"
```

Para cada caller encontrado, garantir que `businessEventId` é passado. O padrão é:

```typescript
// ANTES — sem evento
await this.inventoryLedger.recordMovement(ctx, {
  patrimonyItemId: item.id,
  transactionType: 'acquisition',
  quantity: 100,
  unitPrice: 35.00,
  totalNetValue: -3500,
  transactionDate: '2026-01-10',
});

// DEPOIS — com evento obrigatório
const eventId = await this.businessEvents.ensureByRef(ctx, {
  sourceRef: `BTG-NOTA-${noteNumber}`,
  eventKind: 'buy',
  occurredOn: '2026-01-10',
  settlesOn: settlementDate,
  sourceModule: 'INVEST',
  totalNet: -3500,
});

await this.inventoryLedger.recordMovement(ctx, {
  patrimonyItemId: item.id,
  transactionType: 'acquisition',
  quantity: 100,
  unitPrice: 35.00,
  totalNetValue: -3500,
  transactionDate: '2026-01-10',
  businessEventId: eventId, // ← obrigatório
});
```

**Callers esperados para revisar (verificar com grep acima):**
- `src/core/invest/btgUploadImportService.ts`
- `src/core/invest/reconcile/reconcileNotesIndex.ts`
- `src/modules/invest/InvestOperations.ts`
- `src/core/invest/LedgerImportService.ts`
- Qualquer outro que aparecer no grep

---

## Arquivo 4 — `src/modules/invest/InvestOperations.ts`

### Garantir que `recordOperation` sempre cria ou recebe evento

Localizar `recordOperation` ou equivalente. O padrão deve ser:

```typescript
async recordOperation(
  ctx: UserContext,
  input: {
    // ... campos da operação
    businessEventId?: string; // pode vir de fora (reimport idempotente)
  }
): Promise<{ patrimonyLegId: string; financialLegId?: string; eventId: string }> {

  // 1. Garantir evento — criar se não veio de fora
  const eventId = input.businessEventId
    ?? await this.businessEvents.ensureByRef(ctx, {
        sourceRef: input.sourceRef ?? `INVEST-OP-${input.transactionDate}-${input.ticker}`,
        eventKind: input.operationType,
        occurredOn: input.transactionDate,
        settlesOn: input.settlementDate ?? input.transactionDate,
        sourceModule: 'INVEST',
        totalNet: input.totalNetValue,
      });

  // 2. Gravar perna patrimonial com evento
  const patrimonyLegId = await this.inventoryLedger.recordMovement(ctx, {
    ...input,
    businessEventId: eventId, // ← sempre presente
  });

  // 3. Gravar perna financeira com evento (se aplicável)
  let financialLegId: string | undefined;
  if (input.createFinancialLeg) {
    financialLegId = await this.financialLedger.record(ctx, {
      ...input,
      businessEventId: eventId, // ← mesmo evento
      relatedPatrimonyLedgerId: patrimonyLegId,
    });
  }

  return { patrimonyLegId, financialLegId, eventId };
}
```

---

## Arquivo 5 — `src/core/invest/reconcile/ReconciliationAuditService.ts`

### Adicionar auditoria de pernas órfãs

Adicionar um novo método `checkOrphanLegs` e incluí-lo na lista de checks do `run`:

```typescript
private async checkOrphanLegs(
  ctx: UserContext,
  through: string
): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];

  // Pernas patrimoniais sem business_event_id
  const orphanPatrimony = await this.gateway.findWhere(
    ctx,
    'patrimony_ledger_entries',
    {},
    {
      extraWhere: 'business_event_id IS NULL AND transaction_date <= ?',
      extraParams: [through],
      limit: 100,
    }
  );

  for (const row of orphanPatrimony) {
    issues.push({
      dimensionId: 20,
      kind: 'orphan_patrimony_leg',
      severity: 'critical',
      summaryKey: 'invest.reconcile.audit.orphan_patrimony_leg',
      context: {
        legId: row.id,
        ticker: row.asset_ticker,
        date: row.transaction_date,
        type: row.transaction_type,
      },
      rowKeys: [`pat:${row.id}`],
    });
  }

  // Pernas financeiras sem business_event_id
  const orphanFinancial = await this.gateway.findWhere(
    ctx,
    'financial_ledger_entries',
    {},
    {
      extraWhere: 'business_event_id IS NULL AND transaction_date <= ?',
      extraParams: [through],
      limit: 100,
    }
  );

  for (const row of orphanFinancial) {
    issues.push({
      dimensionId: 21,
      kind: 'orphan_financial_leg',
      severity: 'critical',
      summaryKey: 'invest.reconcile.audit.orphan_financial_leg',
      context: {
        legId: row.id,
        accountId: row.account_id,
        date: row.transaction_date,
        amount: row.amount,
      },
      rowKeys: [`fin:${row.id}`],
    });
  }

  return issues;
}
```

Incluir no método `run`:
```typescript
async run(ctx: UserContext, opts: AuditRunOptions = {}): Promise<AuditReport> {
  const through = opts.throughDate ?? new Date().toISOString().slice(0, 10);
  const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', through);

  const issues: AuditIssue[] = [];
  issues.push(...this.checkLedgerDedup(events));
  issues.push(...this.checkTradeCoverage(events, through));
  issues.push(...this.checkCashNoteLinks(events));
  issues.push(...(await this.checkCustodyQty(ctx, events, opts)));
  issues.push(...(await this.checkOrphanLegs(ctx, through))); // ← ADICIONAR

  return buildAuditReport(issues);
}
```

---

## Verificação final

```bash
# 1. Nenhum caller sem businessEventId
grep -rn "recordMovement\|FinancialLedger.*\.record(" src/ --include="*.ts" \
  | grep -v "test\|spec\|node_modules" \
  | grep -v "businessEventId"
# Esperado: zero resultados

# 2. Build limpo
npm run build
# Esperado: zero erros

# 3. Testes
npm test
# Esperado: zero regressões
```

---

## Definition of Done

- [ ] `InventoryLedger.recordMovement` lança `GatewayError` se `businessEventId` ausente
- [ ] `FinancialLedger.record` lança `GatewayError` se `businessEventId` ausente
- [ ] Todos os callers passam `businessEventId`
- [ ] `InvestOperations.recordOperation` sempre garante evento (cria ou recebe)
- [ ] `ReconciliationAuditService` detecta pernas órfãs como `critical`
- [ ] `npm run build` sem erros
- [ ] `npm test` sem regressões
- [ ] **NÃO** alterar schema do banco nesta fase (NOT NULL fica para a Fase 6)
