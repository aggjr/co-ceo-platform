import '../styles/coceo-excel-table.css';
import '../styles/invest-portfolio.css';
import '../styles/invest-panorama.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated } from '../auth/session.js';
import { apiRequest } from '../api/client.js';
import { formatBrl } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';
import {
  bandColumnLabels,
  buildPanoramaDecisionModel,
  DEFAULT_PANORAMA_THRESHOLDS,
} from '../lib/investOptionsForecastModel.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function signedBrlCell(value, { emphasize = false } = {}) {
  const n = Number(value) || 0;
  let cls = 'panorama-val--zero';
  if (n > 0) cls = 'portfolio-pnl--up';
  else if (n < 0) cls = 'portfolio-pnl--down';
  const weight = emphasize ? 'font-weight:700;font-size:1.02rem;' : '';
  return `<span class="${cls}" style="${weight}">${formatBrl(n)}</span>`;
}

function renderTableRow(row) {
  const trClass = [
    'hoverable-row',
    row.summary ? 'summary-row' : '',
    row.final ? 'panorama-row--final' : '',
    row.side === 'put' ? 'panorama-row--put' : '',
    row.side === 'call' ? 'panorama-row--call' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <tr class="${trClass}">
      <td class="panorama-col-grupo">${escapeHtml(row.grupo)}</td>
      <td class="panorama-col-label">${escapeHtml(row.label)}</td>
      <td class="panorama-col-valor">${signedBrlCell(row.valor, { emphasize: row.final })}</td>
      <td class="panorama-col-ref">${escapeHtml(row.nota)}</td>
    </tr>
  `;
}

function renderMainTable(model) {
  const { capital, options, posicaoLiquida, thresholds } = model;
  const p1 = thresholds?.pct1 ?? DEFAULT_PANORAMA_THRESHOLDS.pct1;
  const p2 = thresholds?.pct2 ?? DEFAULT_PANORAMA_THRESHOLDS.pct2;
  const putLabels = bandColumnLabels('put', thresholds);
  const callLabels = bandColumnLabels('call', thresholds);

  const rows = [
    {
      grupo: 'Liquidez atual',
      label: 'Conta corrente (caixa BTG)',
      valor: capital.caixa,
      nota: 'Saldo liquidado no extrato',
    },
    {
      grupo: 'Liquidez atual',
      label: 'Renda fixa (Tesouro / LFT)',
      valor: capital.rendaFixa,
      nota: 'Valor de mercado na custódia',
    },
    {
      grupo: 'Liquidez atual',
      label: 'CDB',
      valor: capital.cdb,
      nota: 'Valor de mercado na custódia',
    },
    {
      grupo: 'Liquidez atual',
      label: 'Subtotal liquidez',
      valor: capital.totalLiquido,
      nota: 'Caixa + RF + CDB',
      summary: true,
    },
    {
      grupo: 'Notional PUT',
      side: 'put',
      label: `PUT — ${putLabels.itm}`,
      valor: options.putsSignedItm,
      nota: 'Necessidade de caixa (negativo)',
    },
    {
      grupo: 'Notional PUT',
      side: 'put',
      label: `PUT — ${putLabels.cumPct1}`,
      valor: options.putsSignedCumPct1,
      nota: `Cumulativo até ~${p1}% abaixo do strike`,
    },
    {
      grupo: 'Notional PUT',
      side: 'put',
      label: `PUT — ${putLabels.cumPct2}`,
      valor: options.putsSignedCumPct2,
      nota: `Cumulativo até ~${p2}% abaixo do strike`,
    },
    {
      grupo: 'Notional PUT',
      side: 'put',
      label: `PUT — ${putLabels.total}`,
      valor: options.putsSignedTotal,
      nota: 'Soma de todas as faixas (negativo)',
      summary: true,
    },
    {
      grupo: 'Notional CALL',
      side: 'call',
      label: `CALL — ${callLabels.itm}`,
      valor: options.callsSignedItm,
      nota: 'Geração de caixa por venda de ações (positivo)',
    },
    {
      grupo: 'Notional CALL',
      side: 'call',
      label: `CALL — ${callLabels.cumPct1}`,
      valor: options.callsSignedCumPct1,
      nota: `Cumulativo até ~${p1}% acima do strike`,
    },
    {
      grupo: 'Notional CALL',
      side: 'call',
      label: `CALL — ${callLabels.cumPct2}`,
      valor: options.callsSignedCumPct2,
      nota: `Cumulativo até ~${p2}% acima do strike`,
    },
    {
      grupo: 'Notional CALL',
      side: 'call',
      label: `CALL — ${callLabels.total}`,
      valor: options.callsSignedTotal,
      nota: 'Soma de todas as faixas (positivo)',
      summary: true,
    },
    {
      grupo: 'Síntese opções',
      side: 'put',
      label: `PUT na síntese (ITM + até ${p1}%)`,
      valor: options.putsSigned,
      nota: 'Entra negativo na posição líquida',
      summary: true,
    },
    {
      grupo: 'Síntese opções',
      side: 'call',
      label: 'CALL na síntese (só ITM)',
      valor: options.callsSigned,
      nota: 'Entra positivo na posição líquida',
      summary: true,
    },
    {
      grupo: 'Síntese opções',
      label: 'Efeito líquido opções',
      valor: options.netOptionFlow,
      nota: 'CALLs ITM − PUTs (ITM + 1ª faixa)',
      summary: true,
    },
    {
      grupo: 'Síntese',
      label: 'Posição líquida ajustada',
      valor: posicaoLiquida,
      nota: 'Liquidez + efeito opções',
      summary: true,
      final: true,
    },
  ];

  const body = rows.map(renderTableRow).join('');

  return `
    <div class="table-wrapper">
      <table class="excel-table panorama-table">
        <thead>
          <tr>
            <th style="text-align:left;width:130px;">Bloco</th>
            <th style="text-align:left;">Indicador</th>
            <th style="text-align:right;width:168px;">Valor (R$)</th>
            <th style="text-align:left;">Referência</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderPanorama(root, optionRows, titulosPayload) {
  const model = buildPanoramaDecisionModel(
    optionRows,
    titulosPayload?.items || [],
    titulosPayload?.cashStatementBalance ?? 0,
    DEFAULT_PANORAMA_THRESHOLDS,
  );

  root.innerHTML = `
    <div class="portfolio-excel-section panorama-page">
      <p class="panorama-lead">
        Notionais por faixa (cumulativos). PUTs em vermelho = caixa necessário; CALLs ITM em verde = venda de ações.
        Faixas fixas: ${DEFAULT_PANORAMA_THRESHOLDS.pct1}% e ${DEFAULT_PANORAMA_THRESHOLDS.pct2}%.
      </p>
      <h2 class="portfolio-excel-title">Liquidez e síntese</h2>
      ${renderMainTable(model)}
    </div>
  `;
}

export async function InvestPanoramaPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const hostId = 'invest-panorama-root';
  await renderShell(container, {
    title: 'INVEST — Panorama geral',
    contentHtml: `<div class="card invest-table-card" id="${hostId}">
      <div class="loading-spinner" style="margin: 2rem;"></div>
    </div>`,
  });

  const root = container.querySelector(`#${hostId}`);
  if (!root) return;

  try {
    const [optionRows, titulosPayload] = await Promise.all([
      fetchOpenOptionsPortfolio(),
      apiRequest('/api/invest/portfolio?assetClass=fixedIncome'),
    ]);
    renderPanorama(root, optionRows, titulosPayload);
  } catch (err) {
    root.innerHTML = `<div style="padding:2rem;color:#ef4444;">${escapeHtml(err.message)}</div>`;
  }
}
