import { formatBrl } from './portfolioDisplay.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Gráfico SVG de patrimônio diário (sem dependências externas).
 */
export function renderPatrimonyChart(series, { width = 720, height = 280 } = {}) {
  if (!series?.length) {
    return '<p class="muted">Sem dados no período — importe o livro-razão em Resultado.</p>';
  }

  const pad = { top: 24, right: 16, bottom: 36, left: 72 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = series.map((p) => p.patrimony);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV || 1;

  const xAt = (i) => pad.left + (series.length <= 1 ? 0 : (i / (series.length - 1)) * innerW);
  const yAt = (v) => pad.top + innerH - ((v - minV) / span) * innerH;

  const points = series.map((p, i) => `${xAt(i)},${yAt(p.patrimony)}`).join(' ');

  const yTicks = 4;
  const gridLines = [];
  for (let t = 0; t <= yTicks; t++) {
    const v = minV + (span * t) / yTicks;
    const y = yAt(v);
    gridLines.push(
      `<line x1="${pad.left}" y1="${y}" x2="${pad.left + innerW}" y2="${y}" class="patrimony-grid" />`
    );
    gridLines.push(
      `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" class="patrimony-axis">${escapeHtml(
        formatBrl(v).replace(/\s/g, '\u00a0')
      )}</text>`
    );
  }

  const xLabels = [];
  const step = Math.max(1, Math.floor(series.length / 6));
  for (let i = 0; i < series.length; i += step) {
    const p = series[i];
    xLabels.push(
      `<text x="${xAt(i)}" y="${height - 8}" text-anchor="middle" class="patrimony-axis">${escapeHtml(
        p.date.slice(5).replace('-', '/')
      )}</text>`
    );
  }

  const last = series[series.length - 1];
  const first = series[0];
  const pendingNote =
    last.pendingSettlements != null && last.pendingSettlements !== 0
      ? `<span>Previsão liquidação: <strong>${formatBrl(last.pendingSettlements)}</strong> · Bruto: <strong>${formatBrl(last.patrimonyGross ?? last.patrimony)}</strong></span>`
      : '';

  return `
    <div class="patrimony-chart-wrap">
      <svg class="patrimony-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução diária do patrimônio">
        ${gridLines.join('')}
        <polyline points="${points}" class="patrimony-line" fill="none" />
        <circle cx="${xAt(series.length - 1)}" cy="${yAt(last.patrimony)}" r="4" class="patrimony-dot" />
        ${xLabels.join('')}
      </svg>
      <div class="patrimony-chart-legend muted">
        <span>${escapeHtml(first.date)} → ${escapeHtml(last.date)}</span>
        <span>Início: <strong>${formatBrl(first.patrimony)}</strong></span>
        <span>Ajustado (BTG): <strong>${formatBrl(last.patrimony)}</strong></span>
        ${pendingNote}
      </div>
    </div>
  `;
}

export function renderSharpeKpi(sharpe) {
  if (!sharpe) return '';
  const value =
    sharpe.sharpe != null
      ? sharpe.sharpe.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
      : '—';
  const hint = sharpe.reason
    ? sharpe.reason
    : `Anualizado (${sharpe.tradingDaysPerYear} du) · rf ${(sharpe.riskFreeAnnual * 100).toFixed(1)}% a.a. · ${sharpe.observationDays} retornos`;

  return `
    <div class="portfolio-kpi patrimony-sharpe">
      <span class="portfolio-kpi-label">Índice Sharpe</span>
      <strong>${value}</strong>
      <span class="portfolio-kpi-sub muted">${escapeHtml(hint)}</span>
    </div>
  `;
}
