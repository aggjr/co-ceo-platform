import { Show, createMemo, createResource, For } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { apiRequest } from '../api/client.js';
import '../styles/invest-portfolio-solid.css';

type ThreePrices = { strict: number; b3: number; managerial: number };

type PortfolioItem = {
  id: string;
  ticker: string;
  assetType: string;
  quantity: number;
  prices: ThreePrices;
  avgPrice: number;
  lastPrice: number;
  updatedQuote: number | null;
  marketValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  callsSold: number | null;
  callsRemaining: number | null;
};

type CashInTransitLine = {
  tradeDate: string;
  settleDate: string;
  amount: number;
  ticker: string;
  transactionType: string;
  rule: string;
  notes: string;
};

type CashInTransit = {
  settledCashBalance: number;
  inTransitNet: number;
  receivables: number;
  payables: number;
  lines: CashInTransitLine[];
};

type PortfolioResponse = {
  success: boolean;
  items: PortfolioItem[];
  summary: {
    positionCount: number;
    totalMarketValue: number;
    totalCostBasis: number;
    totalPnl: number;
    totalPnlPct: number;
  };
  cashStatementBalance: number;
  cashInTransit?: CashInTransit;
};

function isEquityRow(item: PortfolioItem): boolean {
  return item.assetType === 'stock' || item.assetType === 'fii';
}

function formatBrl(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatQty(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function resultClass(value: number | null | undefined): string {
  if (value == null || value === 0) return '';
  return value > 0 ? 'pos' : 'neg';
}

async function fetchPortfolio(): Promise<PortfolioResponse> {
  return apiRequest('/api/invest/portfolio') as Promise<PortfolioResponse>;
}

export function InvestPortfolio() {
  const navigate = useNavigate();

  if (!isAuthenticated()) {
    navigate('/login', { replace: true });
    return null;
  }

  if (isGlobalSession()) {
    return (
      <div class="ip-page">
        <div class="ip-card">
          <h2>Portfólio</h2>
          <p class="ip-muted">
            Na visão plataforma, personifique o titular da holding para ver a carteira com dados reais.
          </p>
          <p class="ip-muted">
            Use <strong>Personificar</strong> no topo e selecione o usuário da organização.
          </p>
        </div>
      </div>
    );
  }

  const [data, { refetch }] = createResource<PortfolioResponse>(fetchPortfolio);

  const equities = createMemo(() =>
    (data()?.items ?? [])
      .filter(isEquityRow)
      .filter((i) => Math.abs(i.quantity) > 1e-6)
      .sort((a, b) => b.costBasis - a.costBasis)
  );

  const totals = createMemo(() => {
    const rows = equities();
    let cost = 0;
    let market = 0;
    let pnl = 0;
    for (const r of rows) {
      cost += r.costBasis;
      market += r.marketValue;
      pnl += r.pnl;
    }
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { cost, market, pnl, pnlPct, count: rows.length };
  });

  return (
    <div class="ip-page">
      <header class="ip-header">
        <div>
          <h1>Portfólio — Ações e FIIs</h1>
          <p class="ip-muted">
            Custódia derivada do livro razão. Três preços recalculados a cada entrada.
          </p>
        </div>
        <button class="ip-btn" type="button" onClick={() => refetch()}>
          Recarregar
        </button>
      </header>

      <Show
        when={!data.loading}
        fallback={<p class="ip-muted">Carregando custódia…</p>}
      >
        <Show
          when={!data.error}
          fallback={
            <div class="ip-error">
              {String((data.error as Error)?.message ?? 'Falha ao carregar.')}
            </div>
          }
        >
          <section class="ip-summary">
            <div class="ip-summary-cell">
              <span class="ip-label">Posições</span>
              <span class="ip-value">{totals().count}</span>
            </div>
            <div class="ip-summary-cell">
              <span class="ip-label">Total investido (custo)</span>
              <span class="ip-value">{formatBrl(totals().cost)}</span>
            </div>
            <div class="ip-summary-cell">
              <span class="ip-label">Valor a mercado</span>
              <span class="ip-value">{formatBrl(totals().market)}</span>
            </div>
            <div class="ip-summary-cell">
              <span class="ip-label">Resultado</span>
              <span class={`ip-value ${resultClass(totals().pnl)}`}>
                {formatBrl(totals().pnl)} ({formatPct(totals().pnlPct)})
              </span>
            </div>
            <div class="ip-summary-cell">
              <span class="ip-label">Saldo conta corrente</span>
              <span class="ip-value">{formatBrl(data()?.cashInTransit?.settledCashBalance ?? data()?.cashStatementBalance ?? 0)}</span>
            </div>
            <div class="ip-summary-cell">
              <span class="ip-label">Valor em trânsito</span>
              <span class={`ip-value ${resultClass(data()?.cashInTransit?.inTransitNet)}`}>
                {formatBrl(data()?.cashInTransit?.inTransitNet ?? 0)}
              </span>
              <span class="ip-muted" style="font-size:11px;display:block;margin-top:4px">
                A receber {formatBrl(data()?.cashInTransit?.receivables ?? 0)} · A pagar{' '}
                {formatBrl(Math.abs(data()?.cashInTransit?.payables ?? 0))}
              </span>
            </div>
          </section>

          <Show when={(data()?.cashInTransit?.lines?.length ?? 0) > 0}>
            <section class="ip-card" style="margin-top:12px">
              <h2 style="font-size:15px;margin:0 0 8px">Valor em trânsito — detalhe</h2>
              <p class="ip-muted" style="margin:0 0 12px">
                Previsão pelo livro (D+1 opções, D+2 ações, RF conforme calendário). Conferir no extrato BTG na data de liquidação.
              </p>
              <div class="ip-table-wrap">
                <table class="ip-table">
                  <thead>
                    <tr>
                      <th>Negócio</th>
                      <th>Liquidação</th>
                      <th>Ativo</th>
                      <th>Regra</th>
                      <th class="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={data()!.cashInTransit!.lines}>
                      {(line) => (
                        <tr>
                          <td>{line.tradeDate}</td>
                          <td>{line.settleDate}</td>
                          <td>{line.ticker}</td>
                          <td>{line.rule}</td>
                          <td class={`num ${resultClass(line.amount)}`}>{formatBrl(line.amount)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <section class="ip-card">
            <div class="ip-table-wrap">
              <table class="ip-table">
                <thead>
                  <tr>
                    <th>Ativo</th>
                    <th class="num">Qtd.</th>
                    <th class="num">PM Estrito</th>
                    <th class="num">PM B3</th>
                    <th class="num">PM Gerencial</th>
                    <th class="num">Último</th>
                    <th class="num">Investido (B3)</th>
                    <th class="num">Valor mercado</th>
                    <th class="num">Resultado</th>
                    <th class="num">% Resultado</th>
                    <th class="num">Peso %</th>
                    <th class="num">CALLs vend. / cap.</th>
                  </tr>
                </thead>
                <tbody>
                  <Show
                    when={equities().length > 0}
                    fallback={
                      <tr>
                        <td colspan="12" class="ip-muted center">
                          Nenhuma ação ou FII em carteira.
                        </td>
                      </tr>
                    }
                  >
                    <For each={equities()}>
                      {(item) => {
                        const sold = item.callsSold ?? 0;
                        const capacity = Math.max(0, item.quantity);
                        return (
                          <tr>
                            <td>
                              <strong>{item.ticker}</strong>
                              <span class="ip-tag">
                                {item.assetType === 'fii' ? 'FII' : 'Ação'}
                              </span>
                            </td>
                            <td class="num">{formatQty(item.quantity)}</td>
                            <td class="num">{formatBrl(item.prices.strict)}</td>
                            <td class="num">{formatBrl(item.prices.b3)}</td>
                            <td class="num">{formatBrl(item.prices.managerial)}</td>
                            <td class="num">{formatBrl(item.lastPrice)}</td>
                            <td class="num">{formatBrl(item.costBasis)}</td>
                            <td class="num">{formatBrl(item.marketValue)}</td>
                            <td class={`num ${resultClass(item.pnl)}`}>
                              {formatBrl(item.pnl)}
                            </td>
                            <td class={`num ${resultClass(item.pnl)}`}>
                              {formatPct(item.pnlPct)}
                            </td>
                            <td class="num">
                              {item.allocationPct != null
                                ? formatPct(item.allocationPct)
                                : '—'}
                            </td>
                            <td class="num">
                              {formatQty(sold)} / {formatQty(capacity)}
                              <Show when={sold > capacity}>
                                <span class="ip-warn"> · descoberto</span>
                              </Show>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </Show>
                </tbody>
                <Show when={equities().length > 0}>
                  <tfoot>
                    <tr>
                      <td>
                        <strong>Total</strong>
                      </td>
                      <td colspan="5"></td>
                      <td class="num">
                        <strong>{formatBrl(totals().cost)}</strong>
                      </td>
                      <td class="num">
                        <strong>{formatBrl(totals().market)}</strong>
                      </td>
                      <td class={`num ${resultClass(totals().pnl)}`}>
                        <strong>{formatBrl(totals().pnl)}</strong>
                      </td>
                      <td class={`num ${resultClass(totals().pnl)}`}>
                        <strong>{formatPct(totals().pnlPct)}</strong>
                      </td>
                      <td></td>
                      <td></td>
                    </tr>
                  </tfoot>
                </Show>
              </table>
            </div>
            <p class="ip-muted small">
              <strong>PM Estrito</strong>: custo de compra + emolumentos.
              <strong> PM B3</strong>: ajustado por prêmios de PUT vendida exercida e CALL comprada exercida (bate com a B3).
              <strong> PM Gerencial</strong>: abate todos os prêmios de opções vendidas no período do lote.
              <strong> Investido (B3)</strong>: quantidade × PM B3.
              <strong> Peso %</strong>: participação no total investido (base B3) em ações e FIIs.
            </p>
          </section>
        </Show>
      </Show>
    </div>
  );
}
