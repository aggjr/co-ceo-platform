import '../styles/invest-portfolio.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import {
  mountPortfolioExcelTables,
  renderInvestPortfolioPage,
  renderInvestOpcoesPage,
  renderInvestTitulosPage,
} from '../lib/portfolioDisplay.js';

function bindPortfolioView(container, items, cashMeta, pageType) {
  const host = container.querySelector('#portfolio-positions');
  if (!host) return;

  if (pageType === 'options') {
    host.innerHTML = renderInvestOpcoesPage(items, '');
  } else if (pageType === 'titulos') {
    host.innerHTML = renderInvestTitulosPage(items, cashMeta);
  } else {
    host.innerHTML = renderInvestPortfolioPage(items, '', cashMeta);
  }
  mountPortfolioExcelTables(host);
}

async function buildInvestPortfolioPage(container, currentPath, pageType) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts([
    'screen.invest.portfolio.title',
    'screen.invest.options.table.title',
    'screen.invest.fixed_income.title',
  ]);

  let pageTitle = t['screen.invest.portfolio.title'];
  if (pageType === 'options') {
    pageTitle = t['screen.invest.options.table.title'];
  } else if (pageType === 'titulos') {
    pageTitle = t['screen.invest.fixed_income.title'];
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
    const assetClassQuery = pageType === 'titulos' ? 'fixedIncome' : pageType;
    const data = await apiRequest(`/api/invest/portfolio?assetClass=${assetClassQuery}`);
    const items = data.items || [];
    const cashMeta = {
      cashStatementBalance: data.cashStatementBalance ?? 0,
      cashInTransit: data.cashInTransit ?? null,
    };
    body = `
      <div class="card invest-table-card">
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

export const InvestEquitiesPage = (container, path) => buildInvestPortfolioPage(container, path, 'equities');
export const InvestOptionsTablePage = (container, path) => buildInvestPortfolioPage(container, path, 'options');
/** @deprecated rota legada — redireciona para Tabela Excel */
export const InvestOptionsPage = InvestOptionsTablePage;
export const InvestFixedIncomePage = (container, path) => buildInvestPortfolioPage(container, path, 'titulos');
