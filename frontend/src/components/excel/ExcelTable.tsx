import { createSignal, createMemo, JSX } from 'solid-js';

export type ExcelColumn<Row> = {
  key: keyof Row & string;
  label: string;
  width?: string;
  sortable?: boolean;
  render?: (row: Row) => JSX.Element;
};

export type ExcelTableTheme = {
  headerBg?: string;
  headerColor?: string;
  rowBg?: string;
  rowAltBg?: string;
  rowHoverBg?: string;
  borderColor?: string;
};

export function ExcelTable<Row extends Record<string, unknown>>(props: {
  columns: ExcelColumn<Row>[];
  rows: Row[];
  theme?: ExcelTableTheme;
  emptyText?: string;
  onRowClick?: (row: Row) => void;
}) {
  const [sortKey, setSortKey] = createSignal<keyof Row | null>(null);
  const [direction, setDirection] = createSignal<'asc' | 'desc'>('asc');

  const tableRows = createMemo(() => {
    if (!sortKey()) return props.rows;
    return [...props.rows].sort((a, b) => {
      const left = a[sortKey() as keyof Row];
      const right = b[sortKey() as keyof Row];
      if (left === right) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      if (typeof left === 'number' && typeof right === 'number') {
        return direction() === 'asc' ? left - right : right - left;
      }
      const leftStr = String(left).localeCompare(String(right), 'pt-BR', { numeric: true });
      return direction() === 'asc' ? leftStr : -leftStr;
    });
  });

  const theme = {
    headerBg: '#0E243B',
    headerColor: '#E2E8F0',
    rowBg: 'rgba(255,255,255,0.03)',
    rowAltBg: 'rgba(255,255,255,0.06)',
    rowHoverBg: 'rgba(218,177,119,0.1)',
    borderColor: 'rgba(255,255,255,0.12)',
    ...props.theme,
  };

  const sort = (column: ExcelColumn<Row>) => {
    if (!column.sortable) return;
    const current = sortKey();
    if (current === column.key) {
      setDirection(direction() === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(column.key);
      setDirection('asc');
    }
  };

  return (
    <div class="card table-wrap" style={{ border: `1px solid ${theme.borderColor}` }}>
      <table>
        <thead style={{ background: theme.headerBg, color: theme.headerColor }}>
          <tr>
            {props.columns.map((column) => (
              <th
                style={{ width: column.width || 'auto', cursor: column.sortable ? 'pointer' : 'default' }}
                onClick={() => sort(column)}
              >
                {column.label}
                {column.sortable && sortKey() === column.key ? ` ${direction() === 'asc' ? '↑' : '↓'}` : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows().length === 0 ? (
            <tr>
              <td colSpan={props.columns.length} style={{ padding: '20px', textAlign: 'center' }}>
                {props.emptyText || 'Nenhum dado disponível.'}
              </td>
            </tr>
          ) : (
            tableRows().map((row, rowIndex) => (
              <tr
                style={{
                  background: rowIndex % 2 === 0 ? theme.rowBg : theme.rowAltBg,
                  cursor: props.onRowClick ? 'pointer' : 'default',
                }}
                onClick={() => props.onRowClick?.(row)}
              >
                {props.columns.map((column) => (
                  <td>{column.render ? column.render(row) : String(row[column.key] ?? '—')}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
