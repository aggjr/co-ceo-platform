import '../styles/invest-options-cards.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { formatDateBr } from '../lib/dateFormat.js';
import {
  cardFieldRows,
  filterOptionsRows,
  groupByExpiry,
  optionMoneynessBand,
  uniqueUnderlyings,
} from '../lib/optionPortfolioModel.js';
import { formatBrl, formatNumber } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TEXT_KEYS = [
  'screen.invest.options.expiry.title',
  'filter.invest.options.all_assets',
  'filter.invest.options.all_types',
  'filter.invest.options.underlying',
  'filter.invest.options.type',
  'filter.invest.options.type_call',
  'filter.invest.options.type_put',
  'column.invest.options.expiry_ticker',
  'column.invest.options.expiry_type',
  'column.invest.options.expiry_qty',
  'column.invest.options.expiry_strike',
  'column.invest.options.expiry_distance',
  'column.invest.options.expiry_result',
  'screen.invest.options.expiry.empty',
  'screen.invest.options.expiry.count_itm',
  'screen.invest.options.expiry.count_positions',
];

function rowBandClass(row) {
  const band = optionMoneynessBand(row);
  if (band === 'itm') return 'opt-expiry-row--itm';
  if (band === 'near') return 'opt-expiry-row--near';
  return '';
}

function renderExpiryView(rows, t, filters) {
  const filtered = filterOptionsRows(rows, filters);
  if (!filtered.length) {
    return `<p class="muted">${escapeHtml(t['screen.invest.options.expiry.empty'])}</p>`;
  }

  const groups = groupByExpiry(filtered);
  return groups
    .map(([iso, groupRows]) => {
      const itmCount = groupRows.filter((r) => optionMoneynessBand(r) === 'itm').length;
      const countLabel = t['screen.invest.options.expiry.count_positions'].replace(
        '{n}',
        String(groupRows.length),
      );
      const itmLabel =
        itmCount > 0
          ? t['screen.invest.options.expiry.count_itm'].replace('{n}', String(itmCount))
          : '';

      const tableRows = groupRows
        .map((row) => {
          const f = cardFieldRows(row);
          return `
            <tr class="${rowBandClass(row)}">
              <td><strong>${escapeHtml(f.ticker)}</strong></td>
              <td>${escapeHtml(f.typeLabel)}</td>
              <td>${escapeHtml(formatNumber(f.quantity, 0))}</td>
              <td>${escapeHtml(f.strike != null ? formatBrl(f.strike) : '—')}</td>
              <td>${escapeHtml(f.distanceText)}</td>
              <td>${escapeHtml(f.pnlFormatted)}</td>
            </tr>
          `;
        })
        .join('');

      return `
        <section class="opt-expiry-block">
          <div class="opt-expiry-head">
            <h3>${escapeHtml(formatDateBr(iso))}</h3>
            <div class="opt-expiry-badges">
              <span class="opt-expiry-badge">${escapeHtml(countLabel)}</span>
              ${
                itmLabel
                  ? `<span class="opt-expiry-badge opt-expiry-badge--risk">${escapeHtml(itmLabel)}</span>`
                  : ''
              }
            </div>
          </div>
          <table class="opt-expiry-mini">
            <thead>
              <tr>
                <th>${escapeHtml(t['column.invest.options.expiry_ticker'])}</th>
                <th>${escapeHtml(t['column.invest.options.expiry_type'])}</th>
                <th>${escapeHtml(t['column.invest.options.expiry_qty'])}</th>
                <th>${escapeHtml(t['column.invest.options.expiry_strike'])}</th>
                <th>${escapeHtml(t['column.invest.options.expiry_distance'])}</th>
                <th>${escapeHtml(t['column.invest.options.expiry_result'])}</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </section>
      `;
    })
    .join('');
}

export async function InvestOptionsByExpiryPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(TEXT_KEYS);
  const title = t['screen.invest.options.expiry.title'];

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

  const filters = { underlying: '', type: '' };
  const underlyings = uniqueUnderlyings(allRows);
  const hostId = 'opt-expiry-root';

  await renderShell(container, {
    title: `INVEST — ${title}`,
    contentHtml: `<div class="card invest-table-card" id="${hostId}"></div>`,
  });

  const root = container.querySelector(`#${hostId}`);
  if (!root) return;

  function paint() {
    const underlyingOpts = [
      `<option value="">${escapeHtml(t['filter.invest.options.all_assets'])}</option>`,
      ...underlyings.map(
        (u) =>
          `<option value="${escapeHtml(u)}"${filters.underlying === u ? ' selected' : ''}>${escapeHtml(u)}</option>`,
      ),
    ].join('');

    root.innerHTML = `
      <div class="opt-cards-toolbar">
        <label>${escapeHtml(t['filter.invest.options.underlying'])}
          <select data-filter="underlying">${underlyingOpts}</select>
        </label>
        <label>${escapeHtml(t['filter.invest.options.type'])}
          <select data-filter="type">
            <option value="">${escapeHtml(t['filter.invest.options.all_types'])}</option>
            <option value="call"${filters.type === 'call' ? ' selected' : ''}>${escapeHtml(t['filter.invest.options.type_call'])}</option>
            <option value="put"${filters.type === 'put' ? ' selected' : ''}>${escapeHtml(t['filter.invest.options.type_put'])}</option>
          </select>
        </label>
      </div>
      <div class="opt-expiry-groups">${renderExpiryView(allRows, t, filters)}</div>
    `;

    root.querySelectorAll('[data-filter]').forEach((el) => {
      el.addEventListener('change', () => {
        filters[el.getAttribute('data-filter')] = el.value;
        paint();
      });
    });
  }

  paint();
}
