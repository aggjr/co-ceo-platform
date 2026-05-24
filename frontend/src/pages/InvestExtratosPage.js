import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import {
  renderExcelTableShell,
  registerExcelTable,
  mountExcelTables,
} from '../lib/excelTable.js';
import '../styles/coceo-excel-table.css';
import '../styles/invest-extratos.css';
import { formatBrl } from '../lib/portfolioDisplay.js';

/** Valor com sinal: entrada positiva, saída negativa (API envia inflow/outflow separados). */
function signedMovement(row) {
  const inf = Number(row.inflow);
  if (Number.isFinite(inf) && inf > 0) return inf;
  const out = Number(row.outflow);
  if (Number.isFinite(out) && out > 0) return -out;
  return 0;
}

function movementCell(row) {
  const n = signedMovement(row);
  if (n === 0) return '<span class="muted">—</span>';
  const cls = n > 0 ? 'cash-extract--in' : 'cash-extract--out';
  return `<span class="${cls}">${formatBrl(n)}</span>`;
}

function balanceCell(row) {
  const n = Number(row.balance);
  if (!Number.isFinite(n)) return '<span class="muted">—</span>';
  if (n > 0) return `<span class="cash-extract--in">${formatBrl(n)}</span>`;
  if (n < 0) return `<span class="cash-extract--out">${formatBrl(n)}</span>`;
  return `<span class="muted">${formatBrl(0)}</span>`;
}

/** Data de liquidação na conta; pregão só quando diferente (D+1/D+2 ou vínculo à nota). */
function dateCell(row) {
  const liq = String(row.dateBr || '').trim() || '—';
  const pregao = String(row.originDate || '').trim();
  if (pregao && pregao !== liq) {
    return `<div class="cash-extract-date"><span>${liq}</span><span class="cash-extract-date__pregao">Pregão ${pregao}</span></div>`;
  }
  return liq;
}

const COLUMNS = [
  {
    key: 'dateBr',
    label: 'Data',
    type: 'text',
    width: '108px',
    sortValue: (r) => r.date || '',
    filterText: (r) => `${r.dateBr || ''} ${r.originDate || ''}`.trim(),
    cell: dateCell,
  },
  { key: 'description', label: 'Histórico', type: 'text' },
  {
    key: 'movement',
    label: 'Entrada / Saída',
    type: 'currency',
    align: 'right',
    width: '128px',
    sortValue: (r) => signedMovement(r),
    filterText: (r) => String(signedMovement(r)),
    cell: movementCell,
  },
  {
    key: 'balance',
    label: 'Saldo',
    type: 'currency',
    align: 'right',
    width: '128px',
    sortValue: (r) => Number(r.balance ?? 0),
    filterText: (r) => String(r.balance ?? ''),
    cell: balanceCell,
  },
  { key: 'ticker', label: 'Ativo Relacionado', type: 'text' },
  { key: 'noteNum', label: 'Nota', type: 'text' },
  { key: 'observation', label: 'Observação', type: 'text', cellClass: (r) => r.observation ? 'error-text' : '' },
];

export async function InvestExtratosPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(
    ['screen.invest.extratos.title'],
    { 'screen.invest.extratos.title': 'Extratos de conta' }
  );
  const screenTitle = t['screen.invest.extratos.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${screenTitle}`,
      contentHtml: '<div class="card"><p class="muted">Personifique o titular da holding para conferir extratos.</p></div>',
    });
    return;
  }

  let body = '<p class="muted">Carregando extratos...</p>';
  let allRows = [];

  try {
    const data = await apiRequest('/api/invest/cash/extract');
    allRows = data.rows || [];
    
    body = `
      <div class="card notes-meta" style="margin-bottom:16px">
        <h2 style="font-size:16px;margin:0 0 8px">${screenTitle}</h2>
        <p class="muted" style="margin:0 0 12px">
          Verificação da liquidação de notas de corretagem (D+1, D+2) e saldo financeiro.
        </p>
      </div>
      <div class="card notes-grid-card" style="margin-bottom:16px">
        <div id="cash-extract-grid-host"></div>
      </div>
    `;
  } catch (err) {
    body = `<div class="error-banner">${err.message || 'Erro ao carregar extratos.'}</div>`;
  }

  await renderShell(container, {
    title: `INVEST — ${screenTitle}`,
    contentHtml: body,
  });

  const host = container.querySelector('#cash-extract-grid-host');
  if (!host) return;

  const tableId = 'cash-extract-excel';
  host.innerHTML = renderExcelTableShell({
    caption: 'Movimentações Financeiras',
    columns: COLUMNS,
    tableId,
  });
  registerExcelTable(tableId, {
    columns: COLUMNS,
    rows: allRows,
    emptyText: 'Nenhuma movimentação de caixa encontrada.',
    gridId: tableId,
  });
  mountExcelTables(host);
}
