import '../styles/invest-portfolio.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import {
  computePortfolioPatrimonyFromTables,
  getUnderlyingFilter,
  mountPortfolioExcelTables,
  renderInvestPortfolioPage,
  renderPortfolioPatrimonyHeader,
  renderUnderlyingFilterSelect,
  setUnderlyingFilter,
} from '../lib/portfolioDisplay.js';

function bindPortfolioView(container, items, cashMeta) {
  const patrimonyHost = container.querySelector('#portfolio-patrimony-host');
  const host = container.querySelector('#portfolio-positions');
  const filterEl = container.querySelector('#portfolio-underlying-filter');
  if (!host) return;

  const paint = () => {
    const underlying = getUnderlyingFilter();
    const totals = computePortfolioPatrimonyFromTables(items, underlying, cashMeta);
    if (patrimonyHost) {
      patrimonyHost.innerHTML = renderPortfolioPatrimonyHeader(totals);
    }
    host.innerHTML = renderInvestPortfolioPage(items, underlying, cashMeta);
    mountPortfolioExcelTables(host);
  };

  filterEl?.addEventListener('change', () => {
    setUnderlyingFilter(filterEl.value);
    paint();
  });

  paint();
}

export async function InvestPortfolioPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const underlyingFilter = getUnderlyingFilter();
  let body = '<p class="muted">Carregando portfólio...</p>';

  if (isGlobalSession()) {
    body = `
      <div class="card">
        <h2 style="font-size:16px;margin-bottom:8px">Portfólio</h2>
        <p class="muted">Personifique o titular da holding para ver a carteira.</p>
      </div>
    `;
    await renderShell(container, { title: 'INVEST — Portfólio', contentHtml: body });
    return;
  }

  try {
    const data = await apiRequest('/api/invest/portfolio');
    const items = data.items || [];
    const cashMeta = {
      cashStatementBalance: data.cashStatementBalance ?? 0,
      cashInTransit: data.cashInTransit ?? null,
    };

    body = `
      <div class="card">
        <div class="portfolio-toolbar">
          <div>
            <h2>Portfólio</h2>
            <p class="muted" style="margin:4px 0 0">
              Ações/FIIs e opções com risco de mercado; caixa e baixo risco (conta, CDB, Tesouro) + trânsito.
            </p>
          </div>
          <div class="portfolio-toolbar-actions">
            ${renderUnderlyingFilterSelect(items, underlyingFilter)}
          </div>
        </div>
        <div id="portfolio-patrimony-host"></div>
        <div id="portfolio-positions"></div>
      </div>
    `;

    await renderShell(container, {
      title: 'INVEST — Portfólio',
      contentHtml: body,
    });
    bindPortfolioView(container, items, cashMeta);
  } catch (err) {
    body = `<div class="error-banner">${err.message || 'Não foi possível carregar o portfólio.'}</div>`;
    await renderShell(container, { title: 'INVEST — Portfólio', contentHtml: body });
  }
}
