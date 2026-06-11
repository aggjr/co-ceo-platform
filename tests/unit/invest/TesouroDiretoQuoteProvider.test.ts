import {
  fetchTesouroDiretoQuotes,
  parseTesouroDiretoCsv,
} from '../../../src/core/invest/TesouroDiretoQuoteProvider';
import { estimateLftVna } from '../../../src/core/invest/lftVnaEstimator';

function textResponse(body: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;
}

describe('TesouroDiretoQuoteProvider', () => {
  it('usa preco historico do CSV do Tesouro quando disponivel', async () => {
    const csv = [
      'Tipo Titulo;Data Vencimento;Data Base;PU Compra Manha;PU Venda Manha;PU Base Manha',
      'Tesouro Selic;01/03/2031;05/06/2026;1002400,10;1002490,20;1002500,12',
    ].join('\n');
    const fetchImpl = jest.fn().mockResolvedValue(textResponse(csv));

    const quotes = await fetchTesouroDiretoQuotes(['LFT-20310301'], {
      asOfDate: '2026-06-05',
      historicalCsvUrls: ['https://example.test/tesouro.csv'],
      fetchImpl,
      fallbackLft: false,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/tesouro.csv',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.stringContaining('text/csv') }) })
    );
    expect(quotes).toEqual([
      {
        ticker: 'LFT-20310301',
        price: 1_002_500.12,
        asOf: '2026-06-05',
        source: 'tesouro_direto',
        kind: 'tesouro_close',
        provider: 'tesouro_transparente_csv',
      },
    ]);
  });

  it('estima LFT pelo VNA quando historico nao retorna cotacao', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(textResponse('Tipo Titulo;Data Vencimento;Data Base;PU Base Manha\n'));

    const quotes = await fetchTesouroDiretoQuotes(['LFT-20310301'], {
      asOfDate: '2026-06-05',
      historicalCsvUrls: ['https://example.test/empty.csv'],
      fetchImpl,
      lftRefDate: '2026-06-01',
      lftRefVna: 1_000_000,
      lftSelicAnual: 0.1475,
    });

    const expected = Math.round(estimateLftVna('2026-06-01', 1_000_000, '2026-06-05', 0.1475) * 100) / 100;
    expect(quotes).toEqual([
      {
        ticker: 'LFT-20310301',
        price: expected,
        asOf: '2026-06-05',
        source: 'computed_cdi',
        kind: 'tesouro_estimated_lft',
        provider: 'lftVnaEstimator:2026-06-01',
      },
    ]);
  });

  it('retorna ausencia controlada para ticker sem suporte imediato', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));

    const quotes = await fetchTesouroDiretoQuotes(['NTNB-20450815'], {
      asOfDate: '2026-06-05',
      historicalCsvUrls: ['https://example.test/offline.csv'],
      fetchImpl,
    });

    expect(quotes).toEqual([]);
  });

  it('parseia cabecalhos comuns do Tesouro Transparente', () => {
    const rows = parseTesouroDiretoCsv(
      [
        'Tipo Título;Data Vencimento;Data Base;Taxa Compra Manhã;PU Venda Manhã',
        'Tesouro Prefixado;01/01/2029;2026-06-05;13,10;780,42',
      ].join('\n')
    );

    expect(rows).toEqual([
      {
        tipoTitulo: 'Tesouro Prefixado',
        vencimento: '2029-01-01',
        dataBase: '2026-06-05',
        price: 780.42,
      },
    ]);
  });
});
