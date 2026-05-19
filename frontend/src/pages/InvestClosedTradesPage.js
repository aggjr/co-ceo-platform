import '../styles/invest-portfolio.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { mountPortfolioExcelTables, renderClosedOptionsTable } from '../lib/portfolioDisplay.js';

export async function InvestClosedTradesPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  if (isGlobalSession()) {
    await renderShell(container, {
      title: 'INVEST — Transações finalizadas',
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
      <div class="card">
        <h2 style="font-size:16px;margin:0 0 8px">Opções finalizadas</h2>
        <p class="muted" style="margin:0 0 16px">
          Posições com quantidade zerada (exercício, vencimento ou encerramento).
          Não aparecem em <a href="/invest/portfolio" data-link>Portfólio</a>.
          A 5ª letra do ticker indica o mês de vencimento (padrão B3).
        </p>
        <div id="closed-options-table-host">${renderClosedOptionsTable(closed)}</div>
      </div>
    `;
  } catch (err) {
    body = `<div class="error-banner">${err.message || 'Erro ao carregar.'}</div>`;
  }

  await renderShell(container, {
    title: 'INVEST — Transações finalizadas',
    contentHtml: body,
  });
  const host = container.querySelector('#closed-options-table-host');
  if (host) mountPortfolioExcelTables(host);
}
