import '../styles/coceo-excel-table.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated } from '../auth/session.js';
import { cardFieldRows } from '../lib/optionPortfolioModel.js';
import { formatBrl, formatNumber } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function processForecastData(allRows) {
  // Filtra apenas opções vendidas
  const shortOptions = allRows.filter((r) => {
    const f = cardFieldRows(r);
    return f.quantity < 0;
  });

  const callsMap = new Map();
  const putsMap = new Map();

  for (const row of shortOptions) {
    const f = cardFieldRows(row);
    const underlying = f.underlying;
    const absNotional = Math.abs(f.notional || 0);
    const totalPremium = Math.abs(f.premiumTotal || 0);
    
    if (f.side === 'call') {
      if (!callsMap.has(underlying)) {
        callsMap.set(underlying, { underlying, notionalItm: 0, notionalNear: 0, notionalTotal: 0, premiumTotal: 0 });
      }
      const st = callsMap.get(underlying);
      st.notionalTotal += absNotional;
      st.premiumTotal += totalPremium;
      if (f.band === 'itm') st.notionalItm += absNotional;
      if (f.band === 'near') st.notionalNear += absNotional;
    } else if (f.side === 'put') {
      if (!putsMap.has(underlying)) {
        putsMap.set(underlying, { underlying, notionalItm: 0, notionalNear: 0, notionalTotal: 0, premiumTotal: 0 });
      }
      const st = putsMap.get(underlying);
      st.notionalTotal += absNotional;
      st.premiumTotal += totalPremium;
      if (f.band === 'itm') st.notionalItm += absNotional;
      if (f.band === 'near') st.notionalNear += absNotional;
    }
  }

  const calls = Array.from(callsMap.values()).sort((a, b) => a.underlying.localeCompare(b.underlying));
  const puts = Array.from(putsMap.values()).sort((a, b) => a.underlying.localeCompare(b.underlying));
  
  return { calls, puts };
}

function renderTable(title, data, emptyMessage) {
  if (!data || data.length === 0) {
    return `
      <div style="margin-bottom: 2rem;">
        <h3 style="color: #f8fafc; font-size: 1.1rem; margin-bottom: 1rem;">${escapeHtml(title)}</h3>
        <p style="color: #94a3b8; font-size: 0.9rem;">${escapeHtml(emptyMessage)}</p>
      </div>
    `;
  }

  let rowsHtml = '';
  let sumItm = 0;
  let sumNear = 0;
  let sumNotional = 0;
  let sumPremium = 0;

  for (const row of data) {
    sumItm += row.notionalItm;
    sumNear += row.notionalNear;
    sumNotional += row.notionalTotal;
    sumPremium += row.premiumTotal;

    rowsHtml += `
      <tr>
        <td style="text-align: left; font-weight: bold; color: #f8fafc;">${escapeHtml(row.underlying)}</td>
        <td style="text-align: right; color: #ef4444;">${formatBrl(row.notionalItm)}</td>
        <td style="text-align: right; color: #f97316;">${formatBrl(row.notionalNear)}</td>
        <td style="text-align: right; color: #3b82f6;">${formatBrl(row.notionalTotal)}</td>
        <td style="text-align: right; color: #10b981;">${formatBrl(row.premiumTotal)}</td>
      </tr>
    `;
  }

  const totalsHtml = `
    <tr class="summary-row">
      <td style="text-align: left;">TOTAL</td>
      <td style="text-align: right;">${formatBrl(sumItm)}</td>
      <td style="text-align: right;">${formatBrl(sumNear)}</td>
      <td style="text-align: right;">${formatBrl(sumNotional)}</td>
      <td style="text-align: right;">${formatBrl(sumPremium)}</td>
    </tr>
  `;

  return `
    <div style="margin-bottom: 2rem; overflow-x: auto;">
      <h3 style="color: #f8fafc; font-size: 1.1rem; margin-bottom: 1rem;">${escapeHtml(title)}</h3>
      <table class="coceo-excel-table" style="width: 100%; min-width: 600px;">
        <thead>
          <tr>
            <th style="text-align: left;">Ação Ref.</th>
            <th style="text-align: right;" title="Opções Dentro do Dinheiro">Notional ITM</th>
            <th style="text-align: right;" title="Opções até 5% fora do dinheiro">Notional Próximo (Até 5%)</th>
            <th style="text-align: right;">Notional Total</th>
            <th style="text-align: right;">Prêmio Total Recebido</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          ${totalsHtml}
        </tfoot>
      </table>
    </div>
  `;
}

function renderForecast(container, allRows) {
  const { calls, puts } = processForecastData(allRows);

  const headerHtml = `
    <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
      <button id="btn-voltar" class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 4px;">&larr; Voltar às Opções</button>
    </div>
    <div style="margin-bottom: 1.5rem;">
      <p style="color: #94a3b8; font-size: 0.95rem;">
        Esta tela sumariza as opções <strong>vendidas</strong> agrupadas por ação. 
        O <strong>Notional</strong> representa o valor financeiro da obrigação caso exercida.
      </p>
    </div>
  `;

  const callsSection = renderTable(
    'Previsão de Vendas (CALLs Vendidas)', 
    calls, 
    'Nenhuma CALL vendida encontrada na carteira.'
  );

  const putsSection = renderTable(
    'Previsão de Compras (PUTs Vendidas)', 
    puts, 
    'Nenhuma PUT vendida encontrada na carteira.'
  );

  container.innerHTML = `
    <div style="padding: 1rem;">
      ${headerHtml}
      
      <div style="display: grid; grid-template-columns: 1fr; gap: 2rem;">
        ${callsSection}
        ${putsSection}
      </div>
    </div>
  `;

  const btnVoltar = container.querySelector('#btn-voltar');
  if (btnVoltar) {
    btnVoltar.addEventListener('click', () => {
      navigate('/invest/opcoes');
    });
  }
}

export async function InvestOptionsForecastPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const hostId = 'opt-forecast-root';

  await renderShell(container, {
    title: 'INVEST - Previsão de Compras e Vendas',
    contentHtml: `<div class="card invest-table-card" id="${hostId}">
      <div class="loading-spinner" style="margin: 2rem;"></div>
    </div>`
  });

  const root = container.querySelector(`#${hostId}`);
  if (!root) return;

  try {
    const allRows = await fetchOpenOptionsPortfolio();
    renderForecast(root, allRows);
  } catch (err) {
    root.innerHTML = `
      <div style="padding: 2rem; color: #ef4444;">
        Erro ao carregar carteira de opções: ${escapeHtml(err.message)}
      </div>
    `;
  }
}
