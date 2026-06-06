import '../styles/coceo-excel-table.css';
import '../styles/invest-portfolio.css';
import '../styles/invest-options-exposure.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { formatDateBr } from '../lib/dateFormat.js';
import { filterOptionsRows, uniqueExpiryDates } from '../lib/optionPortfolioModel.js';
import {
  buildExposureByUnderlying,
  withCumulativeExposure,
} from '../lib/optionExposureTables.js';
import { formatBrl } from '../lib/portfolioDisplay.js';
import {
  clearCoCeoExcelMounts,
  mountCoCeoExcelGrids,
  registerCoCeoExcelMount,
} from '../lib/coCeoExcelGrid.js';
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
  'screen.invest.options.exposure.call_title',
  'column.invest.options.exposure.asset',
  'column.invest.options.exposure.itm',
  'column.invest.options.exposure.band_near_put',
  'column.invest.options.exposure.band_far_put',
  'column.invest.options.exposure.band_near_call',
  'column.invest.options.exposure.band_far_call',
  'column.invest.options.exposure.total',
  'column.invest.options.exposure.total_row',
];

let exposureTableSeq = 0;

function val(t, key, fallback) {
  return t[key] && t[key] !== key ? t[key] : fallback;
}

function buildExposureColumns(labels) {
  return [
    {
      key: 'underlying',
      label: labels.asset,
      type: 'text',
      width: '120px',
      sticky: true,
      render: (row) => {
        const el = document.createElement('strong');
        el.textContent = row.underlying || '—';
        return el;
      },
    },
    {
      key: 'itm',
      label: labels.itm,
      type: 'currency',
      align: 'right',
      width: '128px',
    },
    {
      key: 'cumNear',
      label: labels.bandNear,
      type: 'currency',
      align: 'right',
      width: '148px',
    },
    {
      key: 'cumFar',
      label: labels.bandFar,
      type: 'currency',
      align: 'right',
      width: '168px',
    },
    {
      key: 'total',
      label: labels.total,
      type: 'currency',
      align: 'right',
      width: '128px',
    },
  ];
}

function buildExposureFooterTotals(totals, totalRowLabel) {
  const fmt = (v) =>
    `<span class="portfolio-footer-total">${escapeHtml(formatBrl(v || 0))}</span>`;
  return () => ({
    underlying: `<span class="portfolio-footer-total">${escapeHtml(totalRowLabel)}</span>`,
    itm: fmt(totals.itm),
    cumNear: fmt(totals.cumNear),
    cumFar: fmt(totals.cumFar),
    total: fmt(totals.total),
  });
}

function registerExposureExcelTable(data, labels, { caption, gridKey, sectionClass }) {
  const mountId = `opt-exp-${++exposureTableSeq}`;
  const rows = data.lines.map((line) => ({
    id: line.underlying,
    underlying: line.underlying,
    itm: line.itm,
    cumNear: line.cumNear,
    cumFar: line.cumFar,
    total: line.total,
  }));

  registerCoCeoExcelMount(mountId, {
    gridId: `invest-options-exposure-${gridKey}`,
    coCeoColumns: buildExposureColumns(labels),
    rows,
    emptyText: labels.empty,
    caption,
    footerColumnTotals: data.lines.length
      ? buildExposureFooterTotals(data.totals, labels.totalRow)
      : null,
    summaryLabels: { total: 'Linhas', selected: '' },
  });

  return `<section class="${sectionClass}" data-coceo-excel-mount="${mountId}"></section>`;
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
      empty: val(t, 'screen.invest.options.exposure.empty', 'Nenhuma posição encontrada.'),
      asset: val(t, 'column.invest.options.exposure.asset', 'Ativo'),
      itm: val(t, 'column.invest.options.exposure.itm', 'ITM'),
      bandNear: val(nearKey, side === 'put' ? 'Faixa {pct}% abaixo' : 'Faixa {pct}% acima')
        .replace('{pct}', String(params.pctNear))
        .replace('{pctFar}', String(params.pctFar)),
      bandFar: val(
        farKey,
        side === 'put'
          ? 'Faixa entre {pctNear}% e {pct}% abaixo'
          : 'Faixa entre {pctNear}% e {pct}% acima',
      )
        .replace('{pct}', String(params.pctFar))
        .replace('{pctNear}', String(params.pctNear)),
      total: val(t, 'column.invest.options.exposure.total', 'Total'),
      totalRow: val(t, 'column.invest.options.exposure.total_row', 'Total Geral'),
    };
  }

  function paint() {
    clearCoCeoExcelMounts();
    exposureTableSeq = 0;

    const filtered = params.expiry
      ? filterOptionsRows(allRows, { expiry: params.expiry })
      : [];

    const puts = withCumulativeExposure(
      buildExposureByUnderlying(filtered, 'put', params.pctNear, params.pctFar),
    );
    const calls = withCumulativeExposure(
      buildExposureByUnderlying(filtered, 'call', params.pctNear, params.pctFar),
    );

    const expiryOpts = expiries
      .map((d) => {
        const label = formatDateBr(d);
        const sel = params.expiry === d ? ' selected' : '';
        return `<option value="${escapeHtml(d)}"${sel}>${escapeHtml(label)}</option>`;
      })
      .join('');

    const putTitle = val(
      t,
      'screen.invest.options.exposure.put_title',
      'PUTs - Valores Necessários no próximo Exercício',
    );
    const callTitle = val(
      t,
      'screen.invest.options.exposure.call_title',
      'CALLs - Valores possíveis de serem gerados no proximo Strike',
    );

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

        <div class="opt-exposure-section opt-exposure-section--put">
          ${registerExposureExcelTable(puts, tableLabels('put'), {
            caption: escapeHtml(putTitle),
            gridKey: 'puts',
            sectionClass: 'portfolio-excel-section',
          })}
        </div>

        <div class="opt-exposure-section opt-exposure-section--call">
          ${registerExposureExcelTable(calls, tableLabels('call'), {
            caption: escapeHtml(callTitle),
            gridKey: 'calls',
            sectionClass: 'portfolio-excel-section',
          })}
        </div>
      </div>
    `;

    mountCoCeoExcelGrids(root);

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
