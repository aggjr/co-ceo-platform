import '../styles/coceo-excel-table.css';
import '../styles/invest-portfolio.css';
import '../styles/invest-options-exposure.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { formatDateBr } from '../lib/dateFormat.js';
import { filterOptionsRows, uniqueExpiryDates } from '../lib/optionPortfolioModel.js';
import { buildExposureByUnderlying } from '../lib/optionExposureTables.js';
import { formatBrl } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TEXT_KEYS = [
  'screen.invest.options.exposure.title',
  'screen.invest.options.exposure.empty',
  'filter.invest.options.expiry',
  'field.invest.options.exposure.pct_near',
  'field.invest.options.exposure.pct_far',
  'screen.invest.options.exposure.put_title',
  'screen.invest.options.exposure.put_help',
  'screen.invest.options.exposure.call_title',
  'screen.invest.options.exposure.call_help',
  'column.invest.options.exposure.asset',
  'column.invest.options.exposure.itm',
  'column.invest.options.exposure.band_near_put',
  'column.invest.options.exposure.band_far_put',
  'column.invest.options.exposure.band_near_call',
  'column.invest.options.exposure.band_far_call',
  'column.invest.options.exposure.total',
  'column.invest.options.exposure.total_row',
];

function formatCell(value, approx = true) {
  if (!value || value <= 0) return '<span class="opt-exposure-zero">R$ 0</span>';
  const text = formatBrl(value);
  const cls = approx ? 'opt-exposure-approx' : '';
  const prefix = approx ? '~' : '';
  return `<span class="${cls}">${prefix}${escapeHtml(text)}</span>`;
}

function renderExposureTable(data, labels, colNearKey, colFarKey) {
  if (!data.lines.length) {
    return `<p class="muted">${escapeHtml(labels.empty)}</p>`;
  }

  const body = data.lines
    .map(
      (line) => `
      <tr>
        <td>${escapeHtml(line.underlying)}</td>
        <td>${formatCell(line.itm)}</td>
        <td>${formatCell(line.bandNear)}</td>
        <td>${formatCell(line.bandFar)}</td>
        <td>${formatCell(line.total, false)}</td>
      </tr>`,
    )
    .join('');

  return `
    <div class="table-wrapper opt-exposure-table-wrap">
      <table class="excel-table opt-exposure-table">
        <thead>
          <tr>
            <th>${escapeHtml(labels.asset)}</th>
            <th>${escapeHtml(labels.itm)}</th>
            <th>${escapeHtml(labels.bandNear)}</th>
            <th>${escapeHtml(labels.bandFar)}</th>
            <th>${escapeHtml(labels.total)}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr class="excel-column-totals-row">
            <td>${escapeHtml(labels.totalRow)}</td>
            <td>${formatCell(data.totals.itm)}</td>
            <td>${formatCell(data.totals.bandNear)}</td>
            <td>${formatCell(data.totals.bandFar)}</td>
            <td>${formatCell(data.totals.total, false)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

export async function InvestOptionsExposurePage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(TEXT_KEYS);
  const title = t['screen.invest.options.exposure.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${title}`,
      contentHtml: `<div class="card"><p class="muted">Personifique o titular da holding para ver opções.</p></div>`,
    });
    return;
  }

  let allRows = [];
  try {
    allRows = await fetchOpenOptionsPortfolio();
  } catch (err) {
    await renderShell(container, {
      title: `INVEST — ${title}`,
      contentHtml: `<div class="error-banner">${escapeHtml(err.message)}</div>`,
    });
    return;
  }

  const expiries = uniqueExpiryDates(allRows);
  const params = {
    expiry: expiries[0] || '',
    pctNear: 5,
    pctFar: 10,
  };

  const hostId = 'opt-exposure-root';

  await renderShell(container, {
    title: `INVEST — ${title}`,
    contentHtml: `<div class="card invest-table-card" id="${hostId}"></div>`,
  });

  const root = container.querySelector(`#${hostId}`);
  if (!root) return;

  function tableLabels(side) {
    const nearKey =
      side === 'put'
        ? 'column.invest.options.exposure.band_near_put'
        : 'column.invest.options.exposure.band_near_call';
    const farKey =
      side === 'put'
        ? 'column.invest.options.exposure.band_far_put'
        : 'column.invest.options.exposure.band_far_call';
    return {
      empty: t['screen.invest.options.exposure.empty'],
      asset: t['column.invest.options.exposure.asset'],
      itm: t['column.invest.options.exposure.itm'],
      bandNear: t[nearKey].replace('{pct}', String(params.pctNear)).replace('{pctFar}', String(params.pctFar)),
      bandFar: t[farKey]
        .replace('{pct}', String(params.pctFar))
        .replace('{pctNear}', String(params.pctNear)),
      total: t['column.invest.options.exposure.total'],
      totalRow: t['column.invest.options.exposure.total_row'],
    };
  }

  function paint() {
    const filtered = params.expiry
      ? filterOptionsRows(allRows, { expiry: params.expiry })
      : [];

    const puts = buildExposureByUnderlying(filtered, 'put', params.pctNear, params.pctFar);
    const calls = buildExposureByUnderlying(filtered, 'call', params.pctNear, params.pctFar);

    const expiryOpts = expiries
      .map((d) => {
        const label = formatDateBr(d);
        const sel = params.expiry === d ? ' selected' : '';
        return `<option value="${escapeHtml(d)}"${sel}>${escapeHtml(label)}</option>`;
      })
      .join('');

    root.innerHTML = `
      <div class="portfolio-excel-section opt-exposure-page">
        <div class="table-period-toolbar" id="opt-exposure-filters">
          <label>${escapeHtml(t['filter.invest.options.expiry'])}
            <select data-filter="expiry">${expiryOpts || `<option value="">—</option>`}</select>
          </label>
          <label>${escapeHtml(t['field.invest.options.exposure.pct_near'])}
            <input type="number" data-filter="pctNear" min="0.5" max="50" step="0.5" value="${params.pctNear}" />
          </label>
          <label>${escapeHtml(t['field.invest.options.exposure.pct_far'])}
            <input type="number" data-filter="pctFar" min="1" max="80" step="0.5" value="${params.pctFar}" />
          </label>
        </div>

        <section class="opt-exposure-section opt-exposure-section--put">
          <h2 class="portfolio-excel-title">${escapeHtml(t['screen.invest.options.exposure.put_title'])}</h2>
          <p class="opt-exposure-help">${escapeHtml(t['screen.invest.options.exposure.put_help'].replace('{pct}', String(params.pctFar)))}</p>
          ${renderExposureTable(puts, tableLabels('put'))}
        </section>

        <section class="opt-exposure-section opt-exposure-section--call">
          <h2 class="portfolio-excel-title">${escapeHtml(t['screen.invest.options.exposure.call_title'])}</h2>
          <p class="opt-exposure-help">${escapeHtml(t['screen.invest.options.exposure.call_help'].replace('{pct}', String(params.pctFar)))}</p>
          ${renderExposureTable(calls, tableLabels('call'))}
        </section>
      </div>
    `;

    root.querySelectorAll('[data-filter]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.getAttribute('data-filter');
        if (key === 'expiry') params.expiry = el.value;
        else if (key === 'pctNear') params.pctNear = Number(el.value) || 5;
        else if (key === 'pctFar') params.pctFar = Number(el.value) || 10;
        if (params.pctFar <= params.pctNear) params.pctFar = params.pctNear + 5;
        paint();
      });
    });
  }

  paint();
}
