/**
 * Pivot de resultado — colunas e linhas para excelTable.js
 */
import { formatBrl } from './portfolioDisplay.js';

const PIVOT_VALUE_KEYS = [
  'acao_ganho',
  'dividendos',
  'jcp',
  'put_vendida',
  'put_comprada',
  'call_vendida',
  'call_comprada',
  'locacao',
  'capital_entrada',
  'capital_saida',
  'rendimento_caixa',
  'multas_b3',
  'despesas',
];

export const RESULTADO_PIVOT_TABLE_ID = 'invest-pnl-pivot';

export function buildResultadoPivotExcelConfig(pivot, columnLabels = {}) {
  const columnKeys = ['label', ...PIVOT_VALUE_KEYS, 'total'];
  const cols = [
    {
      key: 'label',
      label: 'Ativo / underlying',
      align: 'left',
      sortValue: (r) => r.underlying || r.label || '',
      filterText: (r) => `${r.label || ''} ${r.underlying || ''}`,
      cell: (r) => `<strong>${r.label || r.underlying}</strong>`,
    },
    ...PIVOT_VALUE_KEYS.map((key) => ({
      key,
      label: columnLabels[key] || key,
      align: 'right',
      sortValue: (r) => Number(r[key] ?? 0),
      filterText: (r) => String(r[key] ?? 0),
      cell: (r) => formatBrl(r[key] ?? 0),
    })),
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      sortValue: (r) => Number(r.total ?? 0),
      filterText: (r) => String(r.total ?? 0),
      cell: (r) => formatBrl(r.total ?? 0),
      cellClass: () => 'pivot-total-col',
    },
  ];

  const rows = [...(pivot?.rows || [])];
  if (pivot?.totals) {
    rows.push({
      ...pivot.totals,
      underlying: 'TOTAL',
      label: 'Total geral',
    });
  }

  return {
    tableId: RESULTADO_PIVOT_TABLE_ID,
    caption: 'Pivot de resultado',
    columns: cols,
    columnKeys,
    rows,
    emptyText: 'Sem lançamentos no período.',
    rowAttrs: (r) => (r.underlying === 'TOTAL' ? 'class="pivot-totals-row"' : ''),
  };
}
