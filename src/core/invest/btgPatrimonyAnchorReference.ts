import type { PatrimonyAnchorFile } from './patrimonyAnchors';

/**
 * Referência BTG homebroker (capturas jan–mai/2026).
 * Espelha migrations 27/33 para org-holding-001; fallback após reset até o banco estar migrado.
 */
export const HOLDING_ORG_ID = 'org-holding-001';

/** Fonte: Dados Patrimônio Mensal em co_ceo_platform (dados) — JAN..JUN_2026.json + snapshot 17/06. */
export const HOLDING_BTG_PATRIMONY_ANCHORS: PatrimonyAnchorFile = {
  month_ends: [
    { date: '2025-12-31', patrimony: 1_212_435.41 },
    { date: '2026-01-01', patrimony: 1_212_435.41 },
    { date: '2026-01-31', patrimony: 1_320_481.6 },
    { date: '2026-02-01', patrimony: 1_320_481.6 },
    { date: '2026-02-28', patrimony: 1_333_604.43 },
    { date: '2026-03-01', patrimony: 1_333_604.43 },
    { date: '2026-03-31', patrimony: 1_392_272.86 },
    { date: '2026-04-01', patrimony: 1_392_272.86 },
    { date: '2026-04-30', patrimony: 1_478_734.38 },
    { date: '2026-05-01', patrimony: 1_478_734.38 },
    { date: '2026-05-31', patrimony: 1_443_024.84 },
    { date: '2026-06-01', patrimony: 1_443_024.84 },
    { date: '2026-06-17', patrimony: 1_374_058.24 },
  ],
  fixed_income_total: 210_615.87,
};

export function btgPatrimonyAnchorReferenceForOrg(
  organizationId: string | null | undefined
): PatrimonyAnchorFile | null {
  if (organizationId === HOLDING_ORG_ID) return HOLDING_BTG_PATRIMONY_ANCHORS;
  return null;
}
