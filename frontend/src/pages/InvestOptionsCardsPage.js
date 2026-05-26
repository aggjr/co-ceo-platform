import '../styles/invest-options-cards.css';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { formatDateBr } from '../lib/dateFormat.js';
import {
  cardFieldRows,
  filterOptionsRows,
  uniqueExpiryDates,
  uniqueUnderlyings,
} from '../lib/optionPortfolioModel.js';
import { formatBrl, formatNumber, formatPct, pnlClass } from '../lib/portfolioDisplay.js';
import { fetchOpenOptionsPortfolio } from '../lib/investOptionsShared.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TEXT_KEYS = [
  'screen.invest.options.cards.title',
  'filter.invest.options.all_assets',
  'filter.invest.options.all_expiries',
  'filter.invest.options.all_types',
  'filter.invest.options.all_distances',
  'filter.invest.options.underlying',
  'filter.invest.options.expiry',
  'filter.invest.options.type',
  'filter.invest.options.distance',
  'filter.invest.options.type_call',
  'filter.invest.options.type_put',
  'filter.invest.options.dist_itm',
  'filter.invest.options.dist_near',
  'filter.invest.options.dist_far',
  'legend.invest.options.itm',
  'legend.invest.options.near',
  'legend.invest.options.far',
  'field.invest.options.ticker',
  'field.invest.options.underlying',
  'field.invest.options.type',
  'field.invest.options.quantity',
  'field.invest.options.strike',
  'field.invest.options.premium',
  'field.invest.options.premium_total',
  'field.invest.options.quote',
  'field.invest.options.notional',
  'field.invest.options.underlying_quote',
  'field.invest.options.strike_distance',
  'field.invest.options.expiry',
  'field.invest.options.result',
  'field.invest.options.result_pct',
  'screen.invest.options.cards.empty',
  'screen.invest.options.cards.summary',
];

function bandClass(band) {
  if (band === 'itm') return 'opt-card--itm';
  if (band === 'near') return 'opt-card--near';
  return 'opt-card--far';
}

function renderCard(row, labels, isDetailed) {
  const f = cardFieldRows(row);
  const badgeClass = f.side === 'put' ? 'opt-card-badge--put' : 'opt-card-badge--call';
  const qtyClass = pnlClass(f.quantity);
  const pnlRowClass = pnlClass(f.pnl);
  const pnlPctRowClass = pnlClass(Number(f.pnlPct));
  const distRowClass =
    f.distanceBrl != null && Number.isFinite(Number(f.distanceBrl))
      ? pnlClass(Number(f.distanceBrl))
      : '';

  const rows = [];

  if (isDetailed) {
    rows.push([labels['field.invest.options.underlying'] || 'Ação ref.', escapeHtml(f.underlying || '?')]);
  }
  
  rows.push([labels['field.invest.options.type'] || 'Tipo', escapeHtml(f.typeLabel)]);
  
  rows.push([
    labels['field.invest.options.quantity'] || 'Quantidade',
    escapeHtml(formatNumber(f.quantity, 0)),
    qtyClass,
  ]);
  
  rows.push([labels['field.invest.options.strike'] || 'Valor strike', escapeHtml(f.strike != null ? formatBrl(f.strike) : '?')]);
  
  rows.push([labels['field.invest.options.premium'] || 'Prêmio', escapeHtml(formatBrl(f.premium))]);
  
  if (isDetailed) {
    rows.push([
      labels['field.invest.options.premium_total'] || 'Prêmio Total',
      escapeHtml(formatBrl(f.premiumTotal)),
    ]);
  }
  
  rows.push([labels['field.invest.options.quote'] || 'Prêmio Atual', escapeHtml(formatBrl(f.quote))]);
  
  if (isDetailed) {
    rows.push([
      labels['field.invest.options.notional'] || 'Notional',
      escapeHtml(f.notional != null ? formatBrl(f.notional) : '?'),
    ]);
    
    rows.push([
      labels['field.invest.options.underlying_quote'] || 'Cotação ação',
      escapeHtml(formatBrl(f.underlyingQuote)),
    ]);
    
    rows.push([labels['field.invest.options.strike_distance'] || 'Dist. à ação', escapeHtml(f.distanceText), distRowClass]);
  }
  
  rows.push([labels['field.invest.options.expiry'] || 'Data strike', escapeHtml(formatDateBr(f.expiry))]);
  
  if (isDetailed) {
    rows.push([labels['field.invest.options.result_pct'] || '% resultado', escapeHtml(f.pnlPctFormatted), pnlPctRowClass]);
    
    rows.push([labels['field.invest.options.result'] || 'Resultado (R$)', escapeHtml(f.pnlFormatted), pnlRowClass]);
  }

  const body = rows
    .map(
      ([label, value, extra = '']) =>
        `<tr class="${extra}"><th>${escapeHtml(label)}</th><td>${value}</td></tr>`,
    )
    .join('');

  return `
    <article class="opt-card ${bandClass(f.distanceBand)}" data-band="${escapeHtml(f.distanceBand)}">
      <header class="opt-card-header">
        <strong>${escapeHtml(f.ticker)}</strong>
        <span class="opt-card-badge ${badgeClass}">${escapeHtml(f.typeLabel)}</span>
      </header>
      <table class="opt-card-table">${body}</table>
    </article>
  `;
}

function buildToolbarHtml(t, underlyings, expiries, filters) {
  const underlyingOpts = [
    `<option value="">${escapeHtml(t['filter.invest.options.all_assets'])}</option>`,
    ...underlyings.map(
      (u) =>
        `<option value="${escapeHtml(u)}"${filters.underlying === u ? ' selected' : ''}>${escapeHtml(u)}</option>`,
    ),
  ].join('');

  const expiryOpts = [
    `<option value="">${escapeHtml(t['filter.invest.options.all_expiries'])}</option>`,
    ...expiries.map((d) => {
      const label = formatDateBr(d);
      return `<option value="${escapeHtml(d)}"${filters.expiry === d ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }),
  ].join('');

  return `
    <div class="opt-cards-toolbar" id="opt-cards-filters">
      <label>${escapeHtml(t['filter.invest.options.underlying'])}
        <select data-filter="underlying">${underlyingOpts}</select>
      </label>
      <label>${escapeHtml(t['filter.invest.options.expiry'])}
        <select data-filter="expiry">${expiryOpts}</select>
      </label>
      <label>${escapeHtml(t['filter.invest.options.type'])}
        <select data-filter="type">
          <option value="">${escapeHtml(t['filter.invest.options.all_types'])}</option>
          <option value="call"${filters.type === 'call' ? ' selected' : ''}>${escapeHtml(t['filter.invest.options.type_call'])}</option>
          <option value="put"${filters.type === 'put' ? ' selected' : ''}>${escapeHtml(t['filter.invest.options.type_put'])}</option>
        </select>
      </label>
      <label>${escapeHtml(t['filter.invest.options.distance'])}
        <select data-filter="band">
          <option value="">${escapeHtml(t['filter.invest.options.all_distances'])}</option>
          <option value="itm"${filters.band === 'itm' ? ' selected' : ''}>${escapeHtml(t['filter.invest.options.dist_itm'])}</option>
          <option value="near"${filters.band === 'near' ? ' selected' : ''}>${escapeHtml(t['filter.invest.options.dist_near'])}</option>
          <option value="far"${filters.band === 'far' ? ' selected' : ''}>${escapeHtml(t['filter.invest.options.dist_far'])}</option>
        </select>
      </label>
      <label>Visualização
        <button type="button" data-action="toggle-view" style="padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.35); background: rgba(15, 23, 42, 0.75); color: inherit; font-size: 13px; cursor: pointer; min-width: 100px;">
          ${filters.detailedView ? 'Detalhado' : 'Resumido'}
        </button>
      </label>
    </div>
    <div class="opt-cards-legend">
      <span class="opt-legend--itm"><i></i>${escapeHtml(t['legend.invest.options.itm'])}</span>
      <span class="opt-legend--near"><i></i>${escapeHtml(t['legend.invest.options.near'])}</span>
      <span class="opt-legend--far"><i></i>${escapeHtml(t['legend.invest.options.far'])}</span>
    </div>
  `;
}

export async function InvestOptionsCardsPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(TEXT_KEYS);
  const title = t['screen.invest.options.cards.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST - ${title}`,
      contentHtml: `<div class="card"><p class="muted">Personifique o titular da holding para ver opções.</p></div>`,
    });
    return;
  }

  let allRows = [];
  try {
    allRows = await fetchOpenOptionsPortfolio();
  } catch (err) {
    await renderShell(container, {
      title: `INVEST - ${title}`,
      contentHtml: `<div class="error-banner">${escapeHtml(err.message)}</div>`,
    });
    return;
  }

  const VIEW_PREF_KEY = 'invest_options_cards_detailed_view';
  const savedPref = localStorage.getItem(VIEW_PREF_KEY);
  const initialDetailedView = savedPref !== null ? savedPref === 'true' : false;

  const filters = { underlying: '', expiry: '', type: '', band: '', detailedView: initialDetailedView };
  const underlyings = uniqueUnderlyings(allRows);
  const expiries = uniqueExpiryDates(allRows);

  const hostId = 'opt-cards-root';

  await renderShell(container, {
    title: `INVEST - ${title}`,
    contentHtml: `<div class="card invest-table-card" id="${hostId}"></div>`,
  });

  const root = container.querySelector(`#${hostId}`);
  if (!root) return;

  function paint() {
    let filtered = filterOptionsRows(allRows, filters);
    
    // Sort by strike (ascending)
    filtered.sort((a, b) => {
      const strikeA = cardFieldRows(a).strike || 0;
      const strikeB = cardFieldRows(b).strike || 0;
      return strikeA - strikeB;
    });

    const summary = t['screen.invest.options.cards.summary']
      .replace('{shown}', String(filtered.length))
      .replace('{total}', String(allRows.length));

    const cards =
      filtered.length > 0
        ? filtered.map((r) => renderCard(r, t, filters.detailedView)).join('')
        : `<p class="muted">${escapeHtml(t['screen.invest.options.cards.empty'])}</p>`;

    root.innerHTML = `
      ${buildToolbarHtml(t, underlyings, expiries, filters)}
      <p class="opt-cards-summary muted">${escapeHtml(summary)}</p>
      <div class="opt-cards-grid">${cards}</div>
    `;

    root.querySelectorAll('[data-filter]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.getAttribute('data-filter');
        if (key === 'underlying') filters.underlying = el.value;
        else if (key === 'expiry') filters.expiry = el.value;
        else if (key === 'type') filters.type = el.value;
        else if (key === 'band') filters.band = el.value;
        paint();
      });
    });

    const toggleBtn = root.querySelector('[data-action="toggle-view"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        filters.detailedView = !filters.detailedView;
        localStorage.setItem(VIEW_PREF_KEY, String(filters.detailedView));
        paint();
      });
    }
  }

  paint();
}
