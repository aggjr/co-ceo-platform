/**
 * Datas de exibição: sempre dd/mm/aaaa (pt-BR).
 * Valores internos / filtros / API permanecem ISO (aaaa-mm-dd).
 */

export function normalizeToIsoDate(v) {
  if (!v || v === '0000-00-00') return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes('T')) {
      const d = s.split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    }
    const pt = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (pt) return `${pt[3]}-${pt[2]}-${pt[1]}`;
    const ptShort = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s);
    if (ptShort) {
      const yy = Number(ptShort[3]);
      const century = yy >= 70 ? 1900 : 2000;
      return `${century + yy}-${ptShort[2]}-${ptShort[1]}`;
    }
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Exibe data no padrão brasileiro; aceita ISO, Date ou string já em dd/mm/aaaa. */
export function formatDateBr(v) {
  if (!v || v === '0000-00-00') return '—';
  if (typeof v === 'string' && /^\d{2}\/\d{2}(\/\d{2,4})?$/.test(v.trim())) {
    const parts = v.trim().split('/');
    if (parts.length === 3 && parts[2].length === 4) return v.trim();
    if (parts.length === 3 && parts[2].length === 2) {
      const yy = Number(parts[2]);
      const century = yy >= 70 ? 1900 : 2000;
      return `${parts[0]}/${parts[1]}/${century + yy}`;
    }
    return v.trim();
  }
  const iso = normalizeToIsoDate(v);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Data e hora para exibição: dd/mm/aaaa HH:mm:ss */
export function formatDateTimeBr(v) {
  if (!v) return '—';
  const s = String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(s);
  if (m) {
    const br = formatDateBr(m[1]);
    return br === '—' ? '—' : `${br} ${m[2]}`;
  }
  return formatDateBr(v);
}
