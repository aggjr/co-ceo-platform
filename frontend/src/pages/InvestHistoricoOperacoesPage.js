import '../styles/coceo-excel-table.css';
import '../styles/invest-historico-operacoes.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import {
  renderExcelTableShell,
  registerExcelTable,
  mountExcelTables,
} from '../lib/excelTable.js';

const COLUMNS = [
  { key: 'pregaoDateBr', label: 'Data', type: 'text' },
  { key: 'ticker', label: 'Ticker', type: 'text' },
  { key: 'tradeType', label: 'TIPO', type: 'text' },
  { key: 'underlyingStock', label: 'Ação ref.', type: 'text' },
  { key: 'side', label: 'C/V', type: 'text' },
  { key: 'unitPrice', label: 'Preço', type: 'currency' },
  { key: 'settlementTax', label: 'Taxa liq./CCP', type: 'currency' },
  { key: 'registrationTax', label: 'Taxa registro', type: 'currency' },
  { key: 'emoluments', label: 'Emolumentos', type: 'currency' },
  { key: 'cblcTotal', label: 'Total CBLC', type: 'currency' },
  { key: 'bovespaTotal', label: 'Total Bovespa', type: 'currency' },
  { key: 'irrf', label: 'IRRF', type: 'currency' },
  {
    key: 'grossValue',
    label: 'Valor contrato',
    type: 'currency',
    cellClass: () => 'notes-contract-value',
  },
  { key: 'quantity', label: 'Qtd', type: 'number' },
  { key: 'maturity', label: 'Venc.', type: 'text' },
  { key: 'noteNumber', label: 'Nr. nota', type: 'text' },
  { key: 'category', label: 'Mercado', type: 'text' },
  { key: 'lineNo', label: 'Linha', type: 'number' },
  {
    key: 'netOperations',
    label: 'Líq. nota (caixa)',
    type: 'currency',
    cellClass: () => 'notes-note-net',
  },
  { key: 'dc', label: 'D/C', type: 'text' },
  { key: 'sourceFile', label: 'Arquivo', type: 'text' },
];

function resolveTradeType(r) {
  if (r.isExercise) return 'EXEC';
  if (r.category === 'LOAN') return 'BTC';
  const mt = String(r.marketType || '').toUpperCase();
  if (/OPCAO\s+DE\s+COMPRA/i.test(mt)) return 'CALL';
  if (/OPCAO\s+DE\s+VENDA/i.test(mt)) return 'PUT';
  if (/EXERC/i.test(mt)) return 'EXEC';
  const t = String(r.ticker || '').toUpperCase();
  if (t.length >= 6 && /^[A-Z]{4}[A-L]/.test(t)) return 'CALL';
  if (t.length >= 6 && /^[A-Z]{4}[M-X]/.test(t)) return 'PUT';
  return '—';
}

function isDisplayableRow(r) {
  const hasOp = Number(r.lineNo) > 0 && (r.side === 'C' || r.side === 'V');
  const hasValue = Math.abs(Number(r.grossValue) || 0) > 0;
  return hasOp || hasValue;
}

/** Mantém números crus — o ExcelTable formata currency (evita NaN). */
function formatRow(r) {
  return {
    ...r,
    pregaoDateBr: r.pregaoDateBr || '—',
    noteNumber: r.noteNumber || '—',
    category: r.category || '—',
    lineNo: r.lineNo ?? '—',
    side: r.side === 'C' || r.side === 'V' ? r.side : '—',
    tradeType: resolveTradeType(r),
    ticker: r.ticker || '—',
    underlyingStock: r.underlyingStock || '—',
    maturity: r.maturity || '—',
    quantity: Number(r.quantity) || 0,
    unitPrice: Number(r.unitPrice) || 0,
    grossValue: Number(r.grossValue) || 0,
    dc: r.dc || '—',
    netOperations: r.netOperations != null ? Number(r.netOperations) : null,
    settlementTax: r.settlementTax != null ? Number(r.settlementTax) : null,
    registrationTax: r.registrationTax != null ? Number(r.registrationTax) : null,
    cblcTotal: r.cblcTotal != null ? Number(r.cblcTotal) : null,
    emoluments: r.emoluments != null ? Number(r.emoluments) : null,
    bovespaTotal: r.bovespaTotal != null ? Number(r.bovespaTotal) : null,
    irrf: r.irrf != null ? Number(r.irrf) : null,
    sourceFile: r.sourceFile || '—',
  };
}

function bindFilters(container, allRows, remount) {
  const catSel = container.querySelector('#notes-filter-category');
  const search = container.querySelector('#notes-filter-search');
  const apply = () => {
    let rows = allRows;
    const cat = catSel?.value;
    if (cat && cat !== 'ALL') rows = rows.filter((r) => r.category === cat);
    const q = (search?.value || '').trim().toUpperCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.ticker || '').toUpperCase().includes(q) ||
          String(r.underlyingStock || '').toUpperCase().includes(q) ||
          String(r.noteNumber || '').includes(q) ||
          String(r.tradeType || '').toUpperCase().includes(q) ||
          String(r.side || '').toUpperCase() === q
      );
    }
    remount(rows);
  };
  catSel?.addEventListener('change', apply);
  search?.addEventListener('input', apply);
}

export async function InvestHistoricoOperacoesPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  if (isGlobalSession()) {
    await renderShell(container, {
      title: 'INVEST — Histórico operações',
      contentHtml:
        '<div class="card"><p class="muted">Personifique o titular da holding para conferir as notas.</p></div>',
    });
    return;
  }

  let body = '<p class="muted">Carregando notas...</p>';
  let allRows = [];

  try {
    const data = await apiRequest('/api/invest/brokerage-notes/review');
    const stats = data.stats || {};
    const dup = data.duplicatesSkipped || [];
    allRows = (data.rows || []).map(formatRow).filter(isDisplayableRow);
    const lineCount = allRows.length;

    body = `
      <div class="card notes-filters" style="margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        <label>Mercado
          <select id="notes-filter-category" style="margin-left:6px">
            <option value="ALL">Todos</option>
            <option value="OPTIONS">Opções</option>
            <option value="SPOT">Vista / exercício</option>
            <option value="LOAN">Aluguel (BTC)</option>
          </select>
        </label>
        <label>Busca (ticker, ação, nota, CALL/PUT/EXEC)
          <input id="notes-filter-search" type="search" placeholder="PRIO, 27421483, PUT..." style="margin-left:6px;min-width:220px" />
        </label>
      </div>
      <div class="card notes-grid-card" style="margin-bottom:16px">
        <div id="brokerage-notes-grid-host"></div>
      </div>
      <div class="card notes-meta" style="margin-bottom:16px">
        <h2 style="font-size:16px;margin:0 0 8px">Histórico de operações registradas</h2>
        <p class="muted" style="margin:0 0 12px">
          Operações de compra, venda, aluguel e exercícios registradas na base de dados (livro razão).
        </p>
        <p class="muted notes-legend" style="margin:0 0 12px">
          <strong class="notes-contract-value">Valor contrato</strong> — líquido de cada negócio/contrato.
          <strong class="notes-note-net">Líq. nota (caixa)</strong> — total líquido da nota/operação.
        </p>
        <p class="muted" style="margin:0">
          Notas/Operações: <strong>${stats.notesKept ?? 0}</strong> · Transações: <strong>${lineCount}</strong>
          · Atualizado em: ${(data.generatedAt || '').slice(0, 19).replace('T', ' ')}
        </p>
      </div>
      ${
        dup.length
          ? `<details class="card notes-duplicates"><summary style="cursor:pointer">Notas duplicadas ignoradas (${dup.length})</summary>
        <pre style="font-size:12px;overflow:auto;max-height:200px">${dup
          .map(
            (d) =>
              `${d.pregaoDate} · ${d.category} · nota ${d.noteNumber} · ${d.sourceFile} (dup de ${d.duplicateOf})`
          )
          .join('\n')}</pre></details>`
          : ''
      }
    `;
  } catch (err) {
    body = `<div class="error-banner">${err.message || 'Erro ao carregar notas.'}</div>`;
  }

  await renderShell(container, {
    title: 'INVEST — Histórico operações (conferência)',
    contentHtml: body,
  });

  const host = container.querySelector('#brokerage-notes-grid-host');
  if (!host) return;

  const tableId = 'brokerage-notes-excel';
  const mountGrid = (rows) => {
    host.innerHTML = renderExcelTableShell({
      caption: 'Movimentações do histórico de operações',
      columns: COLUMNS,
      tableId,
    });
    registerExcelTable(tableId, {
      columns: COLUMNS,
      rows,
      emptyText: 'Nenhuma linha para os filtros selecionados.',
      gridId: tableId,
    });
    mountExcelTables(host);
  };

  mountGrid(allRows);
  bindFilters(container, allRows, mountGrid);
}
