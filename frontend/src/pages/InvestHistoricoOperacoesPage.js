import '../styles/coceo-excel-table.css';
import '../styles/invest-historico-operacoes.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { formatDateBr, formatDateTimeBr } from '../lib/dateFormat.js';
import {
  renderExcelTableShell,
  registerExcelTable,
  mountExcelTables,
} from '../lib/excelTable.js';
import { getPageTexts } from '../navigation/pageTexts.js';

function makeCostRender(key) {
  return (row) => {
    const v = Number(row[key]);
    const span = document.createElement('span');
    if (!v || !Number.isFinite(v)) {
      span.className = 'muted';
      span.textContent = '—';
      return span;
    }
    span.className = 'notes-cost--negative';
    span.textContent = v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return span;
  };
}

function buildColumns(t) {
  return [
    { key: 'pregaoDateBr', label: t['column.invest.historico_operacoes.date'] || 'Data', type: 'text' },
    { key: 'ticker', label: t['column.invest.historico_operacoes.ticker'] || 'Ticker', type: 'text' },
    {
      key: 'tradeType',
      label: t['column.invest.historico_operacoes.type'] || 'TIPO',
      type: 'text',
      render: (row) => {
        const tv = String(row.tradeType || '—');
        const span = document.createElement('span');
        span.textContent = tv;
        if (tv === 'CALL') span.className = 'notes-type--call';
        else if (tv === 'PUT') span.className = 'notes-type--put';
        else if (tv === 'EXEC') span.className = 'notes-type--exec';
        else if (tv === 'BTC') span.className = 'notes-type--btc';
        else if (tv === 'LFT' || tv === 'LTN' || tv === 'CDB') span.className = 'notes-type--rf';
        else if (tv === 'AÇÃO') span.className = 'notes-type--stock';
        return span;
      },
    },
    { key: 'underlyingStock', label: t['column.invest.historico_operacoes.underlying'] || 'Ação ref.', type: 'text' },
    {
      key: 'side',
      label: t['column.invest.historico_operacoes.side'] || 'C/V',
      type: 'text',
      render: (row) => {
        const span = document.createElement('span');
        span.textContent = row.side || '—';
        if (row.side === 'C') span.className = 'notes-cv--buy';
        else if (row.side === 'V') span.className = 'notes-cv--sell';
        return span;
      },
    },
    { key: 'unitPrice', label: t['column.invest.historico_operacoes.unit_price'] || 'Valor/Prêmio', type: 'currency' },
    { key: 'settlementTax', label: t['column.invest.historico_operacoes.settlement_tax'] || 'Taxa liq./CCP', type: 'currency', render: makeCostRender('settlementTax') },
    { key: 'registrationTax', label: t['column.invest.historico_operacoes.registration_tax'] || 'Taxa registro', type: 'currency', render: makeCostRender('registrationTax') },
    { key: 'emoluments', label: t['column.invest.historico_operacoes.emoluments'] || 'Emolumentos', type: 'currency', render: makeCostRender('emoluments') },
    { key: 'cblcTotal', label: t['column.invest.historico_operacoes.cblc_total'] || 'Total CBLC', type: 'currency', render: makeCostRender('cblcTotal') },
    { key: 'bovespaTotal', label: t['column.invest.historico_operacoes.bovespa_total'] || 'Total Bovespa', type: 'currency', render: makeCostRender('bovespaTotal') },
    { key: 'irrf', label: t['column.invest.historico_operacoes.irrf'] || 'IRRF', type: 'currency', render: makeCostRender('irrf') },
    {
      key: 'grossValue',
      label: t['column.invest.historico_operacoes.gross_value'] || 'Valor contrato',
      type: 'currency',
      cellClass: () => 'notes-contract-value',
    },
    { key: 'quantity', label: t['column.invest.historico_operacoes.quantity'] || 'Qtd', type: 'number' },
    { key: 'maturity', label: t['column.invest.historico_operacoes.maturity'] || 'Data Strike', type: 'text' },
    { key: 'noteNumber', label: t['column.invest.historico_operacoes.note_number'] || 'Nr. nota', type: 'text' },
    { key: 'category', label: t['column.invest.historico_operacoes.category'] || 'Mercado', type: 'text' },
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
}

function resolveTradeType(r) {
  if (r.isExercise) return 'EXEC';
  if (r.category === 'LOAN') return 'BTC';
  
  const mt = String(r.marketType || '').toUpperCase();
  if (/OPCAO\s+DE\s+COMPRA/i.test(mt)) return 'CALL';
  if (/OPCAO\s+DE\s+VENDA/i.test(mt)) return 'PUT';
  if (/EXERC/i.test(mt)) return 'EXEC';
  
  const t = String(r.ticker || '').toUpperCase();
  
  // Tesouro e Renda Fixa
  if (t.startsWith('LFT')) return 'LFT';
  if (t.startsWith('LTN')) return 'LTN';
  if (t.startsWith('NTN')) return 'NTN';
  if (t.startsWith('CDB')) return 'CDB';
  if (t.startsWith('CRA')) return 'CRA';
  if (t.startsWith('CRI')) return 'CRI';
  if (t.startsWith('LCI')) return 'LCI';
  if (t.startsWith('LCA')) return 'LCA';
  if (t.startsWith('DEB')) return 'DEBÊNTURE';
  
  // Opções
  if (t.length >= 5 && /^[A-Z]{4}[A-L]\d/.test(t)) return 'CALL';
  if (t.length >= 5 && /^[A-Z]{4}[M-X]\d/.test(t)) return 'PUT';
  
  // FIIs, Ações, BDRs
  if (/^[A-Z]{4}11F?\b/.test(t)) return 'FII';
  if (/^[A-Z]{4}[3456]F?\b/.test(t)) return 'AÇÃO';
  if (/^[A-Z]{4}3[23459]F?\b/.test(t)) return 'BDR';
  
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
    maturity: (() => {
      const br = formatDateBr(r.maturity);
      if (br !== '—') return br;
      return r.maturity || '—';
    })(),
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

  const colKeys = [
    'column.invest.historico_operacoes.date',
    'column.invest.historico_operacoes.ticker',
    'column.invest.historico_operacoes.type',
    'column.invest.historico_operacoes.underlying',
    'column.invest.historico_operacoes.side',
    'column.invest.historico_operacoes.unit_price',
    'column.invest.historico_operacoes.settlement_tax',
    'column.invest.historico_operacoes.registration_tax',
    'column.invest.historico_operacoes.emoluments',
    'column.invest.historico_operacoes.cblc_total',
    'column.invest.historico_operacoes.bovespa_total',
    'column.invest.historico_operacoes.irrf',
    'column.invest.historico_operacoes.gross_value',
    'column.invest.historico_operacoes.quantity',
    'column.invest.historico_operacoes.maturity',
    'column.invest.historico_operacoes.note_number',
    'column.invest.historico_operacoes.category',
    'screen.invest.historico_operacoes.title',
  ];
  const t = await getPageTexts(colKeys);
  const COLUMNS = buildColumns(t);
  const screenTitle = t['screen.invest.historico_operacoes.title'] || 'Histórico de operações';

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${screenTitle}`,
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
    const noFees = stats.linesWithoutFees ?? 0;
    const withFees = stats.linesWithFees ?? 0;
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
        <h2 style="font-size:16px;margin:0 0 8px">${screenTitle}</h2>
        <p class="muted" style="margin:0 0 12px">
          Operações de compra, venda, aluguel e exercícios registradas na base de dados (livro razão).
        </p>
        <p class="muted notes-legend" style="margin:0 0 12px">
          <strong class="notes-contract-value">Valor contrato</strong> — quantidade × preço (nominal, sem taxas).
          Taxas/emolumentos vêm da perna de caixa da mesma nota; se vazias, reimporte notas BTG completas.
          <strong class="notes-note-net">Líq. nota (caixa)</strong> — soma líquida da nota no livro.
        </p>
        ${
          noFees > 0
            ? `<p class="muted" style="margin:0 0 12px;color:#f59e0b">
          <strong>${noFees}</strong> linha(s) sem taxas identificadas
          (${withFees} com taxas). Compare valor contrato × líquido ou rode o script
          <code>audit-brokerage-note-fees.ts</code> nos PDFs/txt.
        </p>`
            : ''
        }
        <p class="muted" style="margin:0">
          Notas/Operações: <strong>${stats.notesKept ?? 0}</strong> · Transações: <strong>${lineCount}</strong>
          · Atualizado em: ${formatDateTimeBr(data.generatedAt)}
        </p>
      </div>
      ${
        dup.length
          ? `<details class="card notes-duplicates"><summary style="cursor:pointer">Notas duplicadas ignoradas (${dup.length})</summary>
        <pre style="font-size:12px;overflow:auto;max-height:200px">${dup
          .map(
            (d) =>
              `${d.pregaoDateBr || formatDateBr(d.pregaoDate)} · ${d.category} · nota ${d.noteNumber} · ${d.sourceFile} (dup de ${d.duplicateOf})`
          )
          .join('\n')}</pre></details>`
          : ''
      }
    `;
  } catch (err) {
    body = `<div class="error-banner">${err.message || 'Erro ao carregar notas.'}</div>`;
  }

  await renderShell(container, {
    title: `INVEST — ${screenTitle}`,
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
