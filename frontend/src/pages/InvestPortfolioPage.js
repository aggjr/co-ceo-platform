import '../styles/invest-portfolio.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
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

async function buildInvestPortfolioPage(container, currentPath, pageType) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const underlyingFilter = getUnderlyingFilter();

  const t = await getPageTexts(
    [
      'screen.invest.portfolio.title',
      'screen.invest.options.title',
      'screen.invest.fixed_income.title',
    ],
    {
      'screen.invest.portfolio.title': 'Ações/FIIs',
      'screen.invest.options.title': 'Opções',
      'screen.invest.fixed_income.title': 'Títulos, RF e CDB',
    }
  );

  let pageTitle = t['screen.invest.portfolio.title'];
  let pageSubtitle = 'Ações e FIIs em custódia aberta.';
  if (pageType === 'options') {
    pageTitle = t['screen.invest.options.title'];
    pageSubtitle = 'Opções vigentes com vencimento futuro.';
  } else if (pageType === 'titulos') {
    pageTitle = t['screen.invest.fixed_income.title'];
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
    const assetClassQuery = pageType === 'titulos' ? 'fixedIncome' : pageType;
    const data = await apiRequest(`/api/invest/portfolio?assetClass=${assetClassQuery}`);
    const items = data.items || [];
    const cashMeta = {
      cashStatementBalance: data.cashStatementBalance ?? 0,
      cashInTransit: data.cashInTransit ?? null,
    };
    const audit = data.threePricesAudit;
    const auditBanner =
      audit && pageType === 'equities' && (audit.warn > 0 || audit.error > 0)
        ? `<div class="card portfolio-3p-audit-banner" style="margin-bottom:12px;padding:12px 16px;border:1px solid rgba(218,177,119,0.4)">
            <strong>Batimento três preços:</strong>
            <span class="portfolio-3p-obs--ok">${audit.ok} OK</span> ·
            <span class="portfolio-3p-obs--warn">${audit.warn} atenção</span> ·
            <span class="portfolio-3p-obs--error">${audit.error} erro</span>
            <span class="muted" style="display:block;margin-top:6px;font-size:12px">
              Coluna <em>Observação (3 preços)</em> na tabela — detalhe por linha. Relatório:
              docs/validacao-tres-precos-${new Date().toISOString().slice(0, 10)}.md
            </span>
          </div>`
        : '';

    body = `
      ${auditBanner}
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

export const InvestEquitiesPage = (container, path) => buildInvestPortfolioPage(container, path, 'equities');
export const InvestOptionsPage = (container, path) => buildInvestPortfolioPage(container, path, 'options');
export const InvestFixedIncomePage = (container, path) => buildInvestPortfolioPage(container, path, 'titulos');
