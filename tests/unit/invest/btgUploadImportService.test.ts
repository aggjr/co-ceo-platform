import {
  applyBtgExtractUpload,
  liqBolsaUnknownEventLine,
  previewBtgExtractUpload,
  settleLiqBolsaEntries,
} from '../../../src/core/invest/btgUploadImportService';
import { inferBusinessEventKind } from '../../../src/core/invest/inferBusinessEventKind';
import { LiqBolsaSettlementService } from '../../../src/core/invest/LiqBolsaSettlementService';
import { settledCashBalanceFromLedger } from '../../../src/core/invest/cashInvestLedger';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import type { LedgerImportLine } from '../../../src/core/invest/ledgerTypes';
import type { UserContext } from '../../../src/core/dal';
import {
  InMemoryGateway,
  castGateway,
} from '../core/business-events/inMemoryGateway';

function uploadText(name: string, text: string) {
  return {
    name,
    contentBase64: Buffer.from(text, 'utf8').toString('base64'),
  };
}

describe('btgUploadImportService', () => {
  it('accepts Saldo Anterior as the opening balance label in BTG extracts', async () => {
    const result = await previewBtgExtractUpload(
      uploadText(
        'Jan_2026.txt',
        `
Cont corrente - Movimentacao
01/01/26 Saldo Anterior 58.758,79
31/01/26 Saldo Final + Rendimento Provisionado de Saldo Remunerado - 3.614,36
`
      )
    );

    expect(result.parseOk).toBe(true);
    expect(result.preview?.openingBalance).toBe(58_758.79);
  });

  it('mantem LIQ BOLSA sem casamento como caixa quando fluxo mensal ja validou', async () => {
    const imported: unknown[] = [];
    const ledger = {
      getOpeningLedgerBalance: jest.fn(async () => 100),
      listLedgerEvents: jest.fn(async () => []),
      reconcileCustody: jest.fn(async () => ({ positions: 0 })),
      settleLiqBolsa: jest.fn(async () => ({
        status: 'blocked',
        reason: 'Nenhum evento candidato encontrado para esta data de liquidacao.',
        candidates: [],
        sumCents: 0,
        deltaCents: 350368,
      })),
      importEntriesOnly: jest.fn(async (_ctx, entries) => {
        imported.push(...entries);
        return { batchId: 'b1', inserted: entries.length, skipped: 0, enriched: 0 };
      }),
    };

    const result = await applyBtgExtractUpload(
      { userId: 'u1', organizationId: 'org1', scope: 'test' } as never,
      ledger as never,
      uploadText(
        'Abr_2026.txt',
        [
          'Saldo Inicial 100,00',
          '01/04/2026 LIQ BOLSA (Operacoes)- Pregao:31/03/2026 3.603,68 3.503,68',
        ].join('\n')
      ),
      {
        parseOptions: { includeLiqBolsa: true },
        keepUnmatchedLiqBolsaAsCash: true,
      }
    );

    expect(result.importOk).toBe(true);
    expect(ledger.settleLiqBolsa).toHaveBeenCalled();
    expect(imported).toHaveLength(1);
    expect((imported[0] as { operation?: string }).operation).toBe('pending_settlement');
  });

  it('converte LIQ BOLSA sem casamento em evento desconhecido investigavel', () => {
    const line = liqBolsaUnknownEventLine(
      {
        date: '2026-04-01',
        ticker: 'CAIXA-BTG',
        operation: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: 3603.68,
        asset_type: 'cash',
        broker_note_ref: 'BTG-EXT-2026-04-01#01',
        notes: 'LIQ BOLSA (Operacoes)- Pregao:31/03/2026',
      },
      'Nenhum evento candidato encontrado para esta data de liquidacao.'
    );

    expect(line.operation).toBe('extract_divergence');
    expect(line.broker_note_ref).toBe('BTG-EXT-2026-04-01#01#LIQ-UNKNOWN');
    expect(line.event_source_ref).toBe('BTG-LIQ-UNKNOWN:2026-04-01:360368');
    expect(line.notes).toContain('PENDENCIA_ANALISE');
    expect(inferBusinessEventKind(line, 'cash_movement')).toBe('unknown_invest_event');
  });
});

describe('settleLiqBolsaEntries — dedup caixa nota x extrato', () => {
  const ctx: UserContext = {
    userId: 'u1',
    organizationId: 'org-test-001',
    impersonatorId: null,
    scope: 'node',
  };

  function ledgerAdapter(gateway: ReturnType<typeof castGateway>) {
    const settler = new LiqBolsaSettlementService(gateway);
    return { settleLiqBolsa: (c: UserContext, input: never) => settler.settle(c, input) } as never;
  }

  /** Caixa liquidado que a NOTA ja gerou (perna AUTO-D2 com :CLEAR). */
  function noteSettledCashEvents(ref: string, date: string, value: number): LedgerEvent[] {
    return [
      {
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        transaction_date: date,
        total_net_value: value,
        broker_note_ref: `AUTO-D2:${ref}`,
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'pending_settlement',
        transaction_date: date,
        total_net_value: 0,
        broker_note_ref: `AUTO-D2:${ref}:CLEAR`,
      } as LedgerEvent,
    ];
  }

  function extractCashEvent(line: LedgerImportLine): LedgerEvent {
    return {
      asset_id: 'ext-cash',
      asset_ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      transaction_type: line.operation,
      transaction_date: line.date,
      quantity: 1,
      unit_price: line.total_net_value ?? 0,
      total_net_value: line.total_net_value ?? 0,
      broker_note_ref: line.broker_note_ref,
    } as unknown as LedgerEvent;
  }

  it('casa credito de extrato NAO rotulado LIQ BOLSA com a liquidacao da nota (1 perna) — antes duplica, depois bate', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    await gateway.insert(ctx, 'business_events', {
      id: 'be-opt',
      source_ref: 'B3-NOTA-27421483',
      event_kind: 'broker_note_option',
      occurred_on: '2026-01-05',
      settles_on: '2026-01-06',
      total_net: 399.48,
    });
    await gateway.insert(ctx, 'financial_ledger_entries', {
      id: 'pending-opt',
      account_id: 'acc-1',
      business_event_id: 'be-opt',
      transaction_date: '2026-01-05',
      settlement_date: '2026-01-06',
      direction: 'in',
      amount: 399.48,
      status: 'pending',
      external_ref: 'AUTO-D2:LEDGER-OPT',
    });

    const extractLine: LedgerImportLine = {
      date: '2026-01-06',
      ticker: 'CAIXA-BTG',
      operation: 'capital_deposit',
      quantity: 1,
      unit_price: 399.48,
      total_net_value: 399.48,
      asset_type: 'cash',
      broker_note_ref: 'BTG-EXT-2026-01-06#01',
      notes: 'TED Credito em Conta',
    };

    // Caixa que a NOTA ja registrou (uma vez). Fechamento do extrato = 399,48.
    const noteCash = noteSettledCashEvents('LEDGER-OPT', '2026-01-06', 399.48);
    const extractClosing = 399.48;

    // ANTES (sem dedup): a linha do extrato seria importada por cima do caixa da nota.
    const balanceAntes = settledCashBalanceFromLedger(
      [...noteCash, extractCashEvent(extractLine)],
      '2026-01-31'
    );
    expect(balanceAntes).toBeCloseTo(798.96, 2);
    expect(Math.abs(balanceAntes - extractClosing)).toBeGreaterThan(0.01);

    const result = await settleLiqBolsaEntries(ctx, ledgerAdapter(gateway), [extractLine]);

    // DEPOIS: a linha do extrato casa a pendencia e NAO cria nova perna de caixa.
    expect(result.matched).toBe(1);
    expect(result.entries).toHaveLength(0);
    const legs = gw.dump('financial_ledger_entries');
    expect(legs.find((l) => l.id === 'pending-opt')!.status).toBe('cancelled');

    const balanceDepois = settledCashBalanceFromLedger(noteCash, '2026-01-31');
    expect(balanceDepois).toBeCloseTo(extractClosing, 2);
    expect(Math.abs(balanceDepois - extractClosing)).toBeLessThanOrEqual(0.01);
  });

  it('credito de extrato sem pendencia de nota correspondente permanece como caixa (gap/divergencia, nunca plug)', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    // Nenhuma perna pending de nota: deposito externo legitimo.
    const extractLine: LedgerImportLine = {
      date: '2026-01-10',
      ticker: 'CAIXA-BTG',
      operation: 'capital_deposit',
      quantity: 1,
      unit_price: 500,
      total_net_value: 500,
      asset_type: 'cash',
      broker_note_ref: 'BTG-EXT-2026-01-10#01',
      notes: 'TED Recebida',
    };

    const result = await settleLiqBolsaEntries(ctx, ledgerAdapter(gateway), [extractLine]);

    expect(result.matched).toBe(0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.broker_note_ref).toBe('BTG-EXT-2026-01-10#01');
    expect(result.entries[0]!.operation).toBe('capital_deposit');
  });

  it('LIQ BOLSA sem casamento preserva divergencia real (evento desconhecido), nao some', async () => {
    const gw = new InMemoryGateway();
    const gateway = castGateway(gw);
    const liqLine: LedgerImportLine = {
      date: '2026-04-01',
      ticker: 'CAIXA-BTG',
      operation: 'pending_settlement',
      quantity: 0,
      unit_price: 0,
      total_net_value: 3503.68,
      asset_type: 'cash',
      broker_note_ref: 'BTG-EXT-2026-04-01#01',
      notes: 'LIQ BOLSA (Operacoes)- Pregao:31/03/2026',
    };

    const result = await settleLiqBolsaEntries(ctx, ledgerAdapter(gateway), [liqLine], {
      keepUnmatchedAsUnknown: true,
    });

    expect(result.matched).toBe(0);
    expect(result.keptAsUnknown).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.operation).toBe('extract_divergence');
    expect(result.entries[0]!.broker_note_ref).toContain('#LIQ-UNKNOWN');
    expect(result.unresolved).toHaveLength(1);
  });
});