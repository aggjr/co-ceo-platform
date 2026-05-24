import type { PatrimonyAnchorFile } from './patrimonyAnchors';

/**
 * Referência estrutural BTG/Necton (capturas 18–19/05/2026).
 * Espelha a migration 26 para org-holding-001; usada em seeds/scripts até o banco estar migrado.
 */
export const HOLDING_ORG_ID = 'org-holding-001';

export const HOLDING_BTG_PATRIMONY_ANCHORS: PatrimonyAnchorFile = {
  month_ends: [
    { date: '2025-12-31', patrimony: 1_224_319 },
    { date: '2026-01-31', patrimony: 1_324_490 },
    { date: '2026-02-28', patrimony: 1_346_751 },
    { date: '2026-03-31', patrimony: 1_413_532 },
    { date: '2026-04-30', patrimony: 1_513_703 },
    { date: '2026-05-18', patrimony: 1_509_811.26 },
    { date: '2026-05-19', patrimony: 1_509_811.26 },
    { date: '2026-05-31', patrimony: 1_509_811.26 },
  ],
  fixed_income_total: 208_292.9,
};

export function btgPatrimonyAnchorReferenceForOrg(
  organizationId: string | null | undefined
): PatrimonyAnchorFile | null {
  if (organizationId === HOLDING_ORG_ID) return HOLDING_BTG_PATRIMONY_ANCHORS;
  return null;
}
