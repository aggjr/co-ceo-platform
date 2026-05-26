import '../styles/coceo-excel-table.css';
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
  processForecastData,
} from '../lib/investOptionsForecastModel.js';

const PANORAMA_THRESH_KEY = 'invest.panorama.thresholds';

function loadThresholds() {
  try {
    const raw = sessionStorage.getItem(PANORAMA_THRESH_KEY);
    if (!raw) return { ...DEFAULT_PANORAMA_THRESHOLDS };
    const p = JSON.parse(raw);
    return {
      pct1: Number(p.pct1) > 0 ? Number(p.pct1) : DEFAULT_PANORAMA_THRESHOLDS.pct1,
      pct2: Number(p.pct2) > 0 ? Number(p.pct2) : DEFAULT_PANORAMA_THRESHOLDS.pct2,
    };
  } catch {
    return { ...DEFAULT_PANORAMA_THRESHOLDS };
  }
}

function saveThresholds(t) {
  sessionStorage.setItem(PANORAMA_THRESH_KEY, JSON.stringify(t));
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function signedBrl(value, { emphasize = false } = {}) {
  const n = Number(value) || 0;
  const cls =
    n > 0 ? 'panorama-val--pos' : n < 0 ? 'panorama-val--neg' : 'panorama-val--zero';
  const weight = emphasize ? 'font-weight:700;font-size:1.05rem;' : 'font-weight:600;';
  return `<span class="${cls}" style="${weight}">${formatBrl(n)}</span>`;
}

function renderMainTable(model) {
  const { capital, options, posicaoLiquida, thresholds } = model;
  const p1 = thresholds?.pct1 ?? 5;
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
      grupo: 'Previsão opções',
      label: `PUTs ITM + até ${p1}% (cumulativo)`,
      valor: options.putsSigned,
      nota: 'Necessidade de caixa (2ª faixa)',
    },
    {
      grupo: 'Previsão opções',
      label: 'CALLs ITM (1º nível)',
      valor: options.callsSigned,
      nota: 'Venda de ações → geração de caixa',
    },
    {
      grupo: 'Previsão opções',
      label: 'Efeito líquido opções',
      valor: options.netOptionFlow,
      nota: 'CALLs ITM − PUTs (ITM + próximo)',
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

  let body = '';
  for (const row of rows) {
    const trClass = row.final ? 'summary-row panorama-row--final' : row.summary ? 'summary-row' : '';
    body += `
      <tr class="${trClass}">
        <td style="text-align:left;color:#94a3b8;font-size:12px;">${escapeHtml(row.grupo)}</td>
        <td style="text-align:left;color:#e2e8f0;">${escapeHtml(row.label)}</td>
        <td style="text-align:right;">${signedBrl(row.valor, { emphasize: row.final })}</td>
        <td style="text-align:left;color:#64748b;font-size:12px;">${escapeHtml(row.nota)}</td>
      </tr>
    `;
  }

  return `
    <table class="coceo-excel-table panorama-table" style="width:100%;max-width:960px;">
      <thead>
        <tr>
          <th style="text-align:left;width:120px;">Bloco</th>
          <th style="text-align:left;">Indicador</th>
          <th style="text-align:right;width:160px;">Valor (R$)</th>
          <th style="text-align:left;">Referência</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function cellBrl(value, negate) {
  const n = negate ? -Math.abs(Number(value) || 0) : Number(value) || 0;
  if (n === 0) return '<span style="color:#64748b;">—</span>';
  return signedBrl(n);
}

/** Tabela estilo referência: Ativo | ITM | Até pct1 | Até pct2 | Total */
function renderBandTable(title, rows, side, thresholds, { negate = false } = {}) {
  const labels = bandColumnLabels(side, thresholds);
  if (!rows?.length) {
    return `<p class="muted">${escapeHtml(title)}: sem posições vendidas.</p>`;
  }

  const totals = {
    itm: 0,
    cumPct1: 0,
    cumPct2: 0,
    total: 0,
  };
  let body = '';
  for (const r of rows) {
    totals.itm += r.notionalItm;
    totals.cumPct1 += r.notionalCumPct1;
    totals.cumPct2 += r.notionalCumPct2;
    totals.total += r.notionalTotal;
    body += `
      <tr>
        <td style="font-weight:600;">${escapeHtml(r.underlying)}</td>
        <td style="text-align:right;">${cellBrl(r.notionalItm, negate)}</td>
        <td style="text-align:right;">${cellBrl(r.notionalCumPct1, negate)}</td>
        <td style="text-align:right;">${cellBrl(r.notionalCumPct2, negate)}</td>
        <td style="text-align:right;">${cellBrl(r.notionalTotal, negate)}</td>
      </tr>
    `;
  }

  return `
    <h3 style="color:#f8fafc;font-size:1.05rem;margin:24px 0 10px;">${escapeHtml(title)}</h3>
    <div style="overflow-x:auto;">
      <table class="coceo-excel-table" style="width:100%;min-width:520px;">
        <thead>
          <tr>
            <th style="text-align:left;">Ativo</th>
            <th style="text-align:right;">${escapeHtml(labels.itm)}</th>
            <th style="text-align:right;">${escapeHtml(labels.cumPct1)}</th>
            <th style="text-align:right;">${escapeHtml(labels.cumPct2)}</th>
            <th style="text-align:right;">${escapeHtml(labels.total)}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr class="summary-row">
            <td>TOTAL</td>
            <td style="text-align:right;">${cellBrl(totals.itm, negate)}</td>
            <td style="text-align:right;">${cellBrl(totals.cumPct1, negate)}</td>
            <td style="text-align:right;">${cellBrl(totals.cumPct2, negate)}</td>
            <td style="text-align:right;">${cellBrl(totals.total, negate)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

let panoramaState = { optionRows: [], titulosPayload: null, thresholds: loadThresholds() };

function renderPanorama(root) {
  const thresholds = panoramaState.thresholds;
  const model = buildPanoramaDecisionModel(
    panoramaState.optionRows,
    panoramaState.titulosPayload?.items || [],
    panoramaState.titulosPayload?.cashStatementBalance ?? 0,
    thresholds
  );
  const { calls, puts } = processForecastData(panoramaState.optionRows, 'ALL', 'ALL', thresholds);

  root.innerHTML = `
    <style>
      .panorama-val--pos { color: #22c55e; }
      .panorama-val--neg { color: #ef4444; }
      .panorama-val--zero { color: #94a3b8; }
      .panorama-row--final td { border-top: 2px solid rgba(218,177,119,0.45); }
      .panorama-thresholds { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:16px; }
      .panorama-thresholds label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:#94a3b8; }
      .panorama-thresholds input { width:72px; padding:6px 8px; border-radius:4px; border:1px solid rgba(148,163,184,0.35); background:rgba(15,23,42,0.8); color:#fff; }
    </style>
    <div style="padding:1rem;">
      <p style="color:#94a3b8;font-size:0.95rem;margin:0 0 1rem;max-width:800px;">
        Notional por faixa (valores cumulativos nas colunas de %). PUTs em <strong style="color:#ef4444">negativo</strong> = caixa necessário;
        CALLs ITM em <strong style="color:#22c55e">positivo</strong> na síntese = venda de ações.
      </p>
      <div class="panorama-thresholds">
        <label>1ª faixa (%)
          <input type="number" id="panorama-pct1" min="0.1" max="50" step="0.5" value="${thresholds.pct1}" />
        </label>
        <label>2ª faixa (%)
          <input type="number" id="panorama-pct2" min="0.1" max="80" step="0.5" value="${thresholds.pct2}" />
        </label>
        <button type="button" id="panorama-apply-pct" class="btn-primary" style="padding:8px 14px;font-size:0.85rem;">Aplicar %</button>
      </div>
      <h3 style="color:#DAB177;font-size:1rem;margin:20px 0 8px;">Liquidez e síntese</h3>
      ${renderMainTable(model)}
      ${renderBandTable('CALLs vendidas', calls, 'call', thresholds, { negate: false })}
      ${renderBandTable('PUTs vendidas', puts, 'put', thresholds, { negate: true })}
    </div>
  `;

  root.querySelector('#panorama-apply-pct')?.addEventListener('click', () => {
    const pct1 = Number(root.querySelector('#panorama-pct1')?.value);
    const pct2 = Number(root.querySelector('#panorama-pct2')?.value);
    if (!Number.isFinite(pct1) || !Number.isFinite(pct2) || pct2 < pct1) return;
    panoramaState.thresholds = { pct1, pct2 };
    saveThresholds(panoramaState.thresholds);
    renderPanorama(root);
  });
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
    panoramaState.optionRows = optionRows;
    panoramaState.titulosPayload = titulosPayload;
    panoramaState.thresholds = loadThresholds();
    renderPanorama(root);
  } catch (err) {
    root.innerHTML = `<div style="padding:2rem;color:#ef4444;">${escapeHtml(err.message)}</div>`;
  }
}
