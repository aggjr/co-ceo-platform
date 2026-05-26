import '../styles/coceo-excel-table.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated } from '../auth/session.js';
import { apiRequest } from '../api/client.js';
import { cardFieldRows } from '../lib/optionPortfolioModel.js';
import { formatBrl, splitPortfolioBySheet } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';
import {
  DEFAULT_PANORAMA_THRESHOLDS,
  processForecastData,
} from '../lib/investOptionsForecastModel.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sumMarketValue(items) {
  return (items || []).reduce((s, i) => s + (Number(i.marketValue) || 0), 0);
}

function renderPutsFundingBlock(cashStatementBalance, fixedIncomeMv) {
  const cash = Number(cashStatementBalance) || 0;
  const rf = Number(fixedIncomeMv) || 0;
  const total = Math.round((cash + rf) * 100) / 100;
  return `
    <div class="opt-forecast-funding" style="margin-top: 12px; padding: 14px 16px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 8px;">
      <h4 style="margin: 0 0 10px; font-size: 0.95rem; color: #e2e8f0;">Liquidez para eventual exercício (PUTs)</h4>
      <table class="coceo-excel-table" style="width: 100%; max-width: 520px;">
        <tbody>
          <tr>
            <td style="text-align: left; color: #94a3b8;">Conta corrente (extrato BTG)</td>
            <td style="text-align: right; font-weight: 600; color: #38bdf8;">${formatBrl(cash)}</td>
          </tr>
          <tr>
            <td style="text-align: left; color: #94a3b8;">Renda fixa (mercado)</td>
            <td style="text-align: right; font-weight: 600; color: #a78bfa;">${formatBrl(rf)}</td>
          </tr>
          <tr class="summary-row">
            <td style="text-align: left;">Total disponível</td>
            <td style="text-align: right;">${formatBrl(total)}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted" style="margin: 10px 0 0; font-size: 12px;">
        Valores para cobrir compras se as PUTs vendidas forem exercidas. Conta corrente = saldo liquidado; renda fixa = LFT, Tesouro e CDB na custódia (valor de mercado).
      </p>
    </div>
  `;
}

function renderTable(title, data, emptyMessage, footerHtml = '') {
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

  for (const item of data) {
    sumItm += item.notionalItm;
    sumNear += item.notionalNear;
    sumNotional += item.notionalTotal;
    sumPremium += item.premiumTotal;

    rowsHtml += `
      <tr>
        <td style="text-align: left; font-weight: 600; color: #e2e8f0;">${escapeHtml(item.underlying)}</td>
        <td style="text-align: right; color: ${item.notionalItm > 0 ? '#ef4444' : '#94a3b8'};">${formatBrl(item.notionalItm)}</td>
        <td style="text-align: right; color: ${item.notionalNear > 0 ? '#f59e0b' : '#94a3b8'};">${formatBrl(item.notionalNear)}</td>
        <td style="text-align: right; color: #38bdf8;">${formatBrl(item.notionalTotal)}</td>
        <td style="text-align: right; color: #10b981;">${formatBrl(item.premiumTotal)}</td>
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
      ${footerHtml}
    </div>
  `;
}

let state = {
  selectedStrike: 'ALL',
  selectedExpiry: 'ALL'
};

function renderForecast(container, allRows, liquidity = {}) {
  // Obter strikes e expiries únicos para opções vendidas
  const shortOptions = allRows.filter((r) => cardFieldRows(r).quantity < 0);
  const strikes = Array.from(new Set(shortOptions.map(r => cardFieldRows(r).strike).filter(s => s != null))).sort((a,b)=>a-b);
  const expiries = Array.from(new Set(shortOptions.map(r => cardFieldRows(r).expiry).filter(Boolean))).sort();

  const strikeOpts = ['<option value="ALL">Strike: Todos</option>']
    .concat(strikes.map(s => `<option value="${s}" ${state.selectedStrike === String(s) ? 'selected' : ''}>R$ ${Number(s).toFixed(2).replace('.',',')}</option>`)).join('');
    
  const expiryOpts = ['<option value="ALL">Vencimento: Todos</option>']
    .concat(expiries.map(e => `<option value="${e}" ${state.selectedExpiry === String(e) ? 'selected' : ''}>${e}</option>`)).join('');

  const { calls, puts } = processForecastData(allRows, state.selectedStrike, state.selectedExpiry);

  const headerHtml = `
    <div style="display: flex; gap: 1rem; margin-bottom: 1rem; align-items: center;">
      <button id="btn-voltar" class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 4px;">&larr; Voltar às Opções</button>
      <select id="sel-expiry" class="coceo-select" style="min-width: 150px; background: rgba(30,41,59,0.8); color: #fff; border: 1px solid rgba(148,163,184,0.3); padding: 6px 12px; border-radius: 4px;">
        ${expiryOpts}
      </select>
      <select id="sel-strike" class="coceo-select" style="min-width: 150px; background: rgba(30,41,59,0.8); color: #fff; border: 1px solid rgba(148,163,184,0.3); padding: 6px 12px; border-radius: 4px;">
        ${strikeOpts}
      </select>
    </div>
    <div style="margin-bottom: 1.5rem;">
      <p style="color: #94a3b8; font-size: 0.95rem;">
        Esta tela sumariza as opções <strong>vendidas</strong> agrupadas por ação. 
        O <strong>Notional</strong> representa o valor financeiro da obrigação caso exercida.
      </p>
    </div>
  `;

  const putsFunding = renderPutsFundingBlock(liquidity.cashStatementBalance, liquidity.fixedIncomeMv);

  const callsSection = renderTable(
    'Previsão de Vendas (CALLs Vendidas)',
    calls,
    'Nenhuma CALL vendida encontrada na carteira.'
  );

  const putsSection = renderTable(
    'Previsão de Compras (PUTs Vendidas)',
    puts,
    'Nenhuma PUT vendida encontrada na carteira.',
    putsFunding
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

  const selStrike = container.querySelector('#sel-strike');
  if (selStrike) {
    selStrike.addEventListener('change', (e) => {
      state.selectedStrike = e.target.value;
      renderForecast(container, allRows, liquidity);
    });
  }

  const selExpiry = container.querySelector('#sel-expiry');
  if (selExpiry) {
    selExpiry.addEventListener('change', (e) => {
      state.selectedExpiry = e.target.value;
      renderForecast(container, allRows, liquidity);
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
    const [allRows, titulosPayload] = await Promise.all([
      fetchOpenOptionsPortfolio(),
      apiRequest('/api/invest/portfolio?assetClass=fixedIncome'),
    ]);
    const { fixedIncome } = splitPortfolioBySheet(titulosPayload.items || []);
    renderForecast(root, allRows, {
      cashStatementBalance: titulosPayload.cashStatementBalance ?? 0,
      fixedIncomeMv: sumMarketValue(fixedIncome),
    });
  } catch (err) {
    root.innerHTML = `
      <div style="padding: 2rem; color: #ef4444;">
        Erro ao carregar carteira de opções: ${escapeHtml(err.message)}
      </div>
    `;
  }
}
