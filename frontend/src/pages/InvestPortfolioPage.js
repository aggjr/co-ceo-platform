import '../styles/invest-portfolio.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import {
  getUnderlyingFilter,
  mountPortfolioExcelTables,
  renderInvestPortfolioPage,
  renderInvestOpcoesPage,
  renderInvestTitulosPage,
  renderUnderlyingFilterSelect,
  setUnderlyingFilter,
} from '../lib/portfolioDisplay.js';

function bindPortfolioView(container, items, cashMeta, pageType) {
  const host = container.querySelector('#portfolio-positions');
  const filterEl = container.querySelector('#portfolio-underlying-filter');
  if (!host) return;

  const paint = () => {
    const underlying = getUnderlyingFilter();
    if (pageType === 'options') {
      host.innerHTML = renderInvestOpcoesPage(items, underlying);
    } else if (pageType === 'titulos') {
      host.innerHTML = renderInvestTitulosPage(items, cashMeta);
    } else {
      host.innerHTML = renderInvestPortfolioPage(items, underlying, cashMeta);
    }
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

  const path = window.location.pathname;
  let pageType = 'equities';
  if (path.includes('/invest/opcoes')) pageType = 'options';
  else if (path.includes('/invest/titulos')) pageType = 'titulos';

  const underlyingFilter = getUnderlyingFilter();
  
  let pageTitle = 'AÇÕES/FIIs';
  let pageSubtitle = 'Ações e FIIs em custódia aberta.';
  if (pageType === 'options') {
    pageTitle = 'Opções';
    pageSubtitle = 'Opções vigentes com vencimento futuro.';
  } else if (pageType === 'titulos') {
    pageTitle = 'Títulos, RF e CDB';
    pageSubtitle = 'Conta corrente, ativos de baixo risco e trânsito.';
  }

  let body = `<p class="muted">Carregando ${pageTitle.toLowerCase()}...</p>`;

  if (isGlobalSession()) {
    body = `
      <div class="card">
        <h2 style="font-size:16px;margin-bottom:8px">${pageTitle}</h2>
        <p class="muted">Personifique o titular da holding para ver a carteira.</p>
      </div>
    `;
    await renderShell(container, { title: `INVEST — ${pageTitle}`, contentHtml: body });
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
            <h2>${pageTitle}</h2>
            <p class="muted" style="margin:4px 0 0">
              ${pageSubtitle}
            </p>
          </div>
          <div class="portfolio-toolbar-actions">
            ${renderUnderlyingFilterSelect(items, underlyingFilter)}
          </div>
        </div>
        <div id="portfolio-positions"></div>
      </div>
    `;

    await renderShell(container, {
      title: `INVEST — ${pageTitle}`,
      contentHtml: body,
    });
    bindPortfolioView(container, items, cashMeta, pageType);
  } catch (err) {
    body = `<div class="error-banner">${err.message || `Não foi possível carregar ${pageTitle}.`}</div>`;
    await renderShell(container, { title: `INVEST — ${pageTitle}`, contentHtml: body });
  }
}
