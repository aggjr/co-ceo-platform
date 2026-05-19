import '../styles/invest-portfolio.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import {
  filterOpenPortfolioItems,
  getUnderlyingFilter,
  mountPortfolioExcelTables,
  renderPortfolioExcelTables,
  renderPortfolioSummary,
  renderUnderlyingFilterSelect,
  setUnderlyingFilter,
} from '../lib/portfolioDisplay.js';

function bindPortfolioView(container, items) {
  const host = container.querySelector('#portfolio-positions');
  const filterEl = container.querySelector('#portfolio-underlying-filter');
  if (!host) return;

  const paint = () => {
    const underlying = getUnderlyingFilter();
    host.innerHTML = renderPortfolioExcelTables(items, underlying);
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
  let body = '<p class="muted">Carregando custódia...</p>';

  if (isGlobalSession()) {
    body = `
      <div class="card">
        <h2 style="font-size:16px;margin-bottom:8px">Portfólio</h2>
        <p class="muted">Na visão plataforma, personifique o titular da holding para ver a carteira com dados reais.</p>
        <p class="portfolio-hint muted">Use <strong>Personificar</strong> no topo e selecione o usuário da organização.</p>
      </div>
    `;
    await renderShell(container, { title: 'INVEST — Portfólio', contentHtml: body });
    return;
  }

  try {
    const patrimonyFrom = '2026-01-01';
    const patrimonyTo = new Date().toISOString().slice(0, 10);
    const [data, patrimony] = await Promise.all([
      apiRequest('/api/invest/portfolio'),
      apiRequest(
        `/api/invest/patrimony-daily?from=${encodeURIComponent(patrimonyFrom)}&to=${encodeURIComponent(patrimonyTo)}`
      ).catch(() => null),
    ]);
    const items = filterOpenPortfolioItems(data.items || []);
    const summaryHtml = renderPortfolioSummary(data.summary, patrimony?.performance);
    body = `
      ${summaryHtml}
      <div class="card">
        <div class="portfolio-toolbar">
          <div>
            <h2>Custódia</h2>
            <p class="muted" style="margin:4px 0 0">Quatro planilhas interativas: filtre e ordene por coluna (como Excel).</p>
          </div>
          <div class="portfolio-toolbar-actions">
            ${renderUnderlyingFilterSelect(items, underlyingFilter)}
          </div>
        </div>
        <div id="portfolio-positions"></div>
        <p class="portfolio-hint muted">Opções vencidas não aparecem na custódia aberta. Quantidade zerada em <a href="/invest/transacoes-finalizadas" data-link>Transações finalizadas</a>. Importe notas em <a href="/invest/resultado" data-link>Resultado</a>.</p>
      </div>
    `;
    await renderShell(container, { title: 'INVEST — Portfólio', contentHtml: body });
    bindPortfolioView(container, items);
  } catch (err) {
    body = `<div class="error-banner">${err.message || 'Não foi possível carregar o portfólio.'}</div>`;
    await renderShell(container, { title: 'INVEST — Portfólio', contentHtml: body });
  }
}
