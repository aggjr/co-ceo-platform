import '../styles/invest-portfolio.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { mountPortfolioExcelTables, renderClosedOptionsTable } from '../lib/portfolioDisplay.js';

export async function InvestClosedTradesPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(['screen.invest.closed_trades.title']);
  const screenTitle = t['screen.invest.closed_trades.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${screenTitle}`,
      contentHtml:
        '<div class="card"><p class="muted">Personifique o titular da holding para ver opções encerradas.</p></div>',
    });
    return;
  }

  let body = '<p class="muted">Carregando...</p>';
  try {
    const data = await apiRequest('/api/invest/portfolio');
    const closed = data.closedOptions || [];
    body = `
      <div class="card invest-table-card">
        <div id="closed-options-table-host">${renderClosedOptionsTable(closed)}</div>
      </div>
    `;
  } catch (err) {
    body = `<div class="error-banner">${err.message || 'Erro ao carregar.'}</div>`;
  }

  await renderShell(container, {
    title: `INVEST — ${screenTitle}`,
    contentHtml: body,
  });
  const host = container.querySelector('#closed-options-table-host');
  if (host) mountPortfolioExcelTables(host);
}
