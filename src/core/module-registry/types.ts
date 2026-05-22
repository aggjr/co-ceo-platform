/**
 * Registry canonico de modulos: quais subcategorias cada modulo "domina".
 * Ver docs/architecture/nucleo_patrimonial.md.
 */

export type ModuleCategoryRow = {
  module_code: string;
  category: string;
  subcategory: string;
  canonical_name: string;
  description: string | null;
  default_quantity_unit: string;
  default_valuation_method: string;
  default_settlement_profile: string;
  is_active: boolean | number;
};

export type ValuationMethodRow = {
  method_code: string;
  canonical_name: string;
  class_path: string;
  description: string | null;
  is_active: boolean | number;
};

export type SettlementProfileRow = {
  profile_code: string;
  canonical_name: string;
  days_offset: number;
  business_days_only: boolean | number;
  default_status: 'pending' | 'cleared';
  description: string | null;
  is_active: boolean | number;
};
