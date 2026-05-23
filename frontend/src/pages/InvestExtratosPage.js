import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import {
  renderExcelTableShell,
  registerExcelTable,
  mountExcelTables,
} from '../lib/excelTable.js';
import '../styles/coceo-excel-table.css';

const COLUMNS = [
  { key: 'dateBr', label: 'Data', type: 'text' },
  { key: 'description', label: 'Histórico', type: 'text' },
  { key: 'inflow', label: 'Entrada', type: 'currency' },
  { key: 'outflow', label: 'Saída', type: 'currency' },
  { key: 'balance', label: 'Saldo', type: 'currency' },
  { key: 'originDate', label: 'Data Operação', type: 'text' },
  { key: 'ticker', label: 'Ativo Relacionado', type: 'text' },
  { key: 'noteNum', label: 'Nota', type: 'text' },
  { key: 'observation', label: 'Observação', type: 'text', cellClass: (r) => r.observation ? 'error-text' : '' },
];

export async function InvestExtratosPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  if (isGlobalSession()) {
    await renderShell(container, {
      title: 'INVEST — Extratos de conta',
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
        <h2 style="font-size:16px;margin:0 0 8px">Evolução do Caixa e Batimento</h2>
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
    title: 'INVEST — Extratos de conta',
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
