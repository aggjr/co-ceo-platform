import { InMemoryGateway } from '../../core/business-events/inMemoryGateway';
import type { UserContext } from '../../../../src/core/dal/types';

export async function seedPolicies(gw: InMemoryGateway, ctx: UserContext) {
  const policies = [
    { operation_code: 'opening_balance', business_event_kind: 'opening_balance', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'opening_balance', cash_direction: 'none', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 1, is_active: 1 },
    { operation_code: 'buy', business_event_kind: 'broker_note_spot', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'acquisition', cash_direction: 'out', default_financial_status: 'cleared', uses_settlement_rules: 1, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 1, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'sell', business_event_kind: 'broker_note_spot', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'disposition', cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 1, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 1, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'pending_settlement', business_event_kind: 'broker_note_spot', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'signed', default_financial_status: 'pending', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'dividend', business_event_kind: 'cash_movement', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 1, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'jcp', business_event_kind: 'cash_movement', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 1, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'cash_yield', business_event_kind: 'cash_movement', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 1, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'securities_lending', business_event_kind: 'broker_note_loan', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: 'cost_adjustment', cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 1, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'fee', business_event_kind: 'cash_movement', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'out', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 1, is_opening: 0, is_active: 1 },
    { operation_code: 'penalty_b3', business_event_kind: 'cash_movement', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'out', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 1, is_opening: 0, is_active: 1 },
    { operation_code: 'cost_adjustment', business_event_kind: 'cash_movement', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'cost_adjustment', cash_direction: 'out', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'capital_deposit', business_event_kind: 'cash_movement', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 1, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'capital_withdrawal', business_event_kind: 'cash_movement', affects_portfolio: 0, affects_financial: 1, inventory_movement_type: null, cash_direction: 'out', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 0, requires_cash_account: 1, is_external_flow_for_twr: 1, is_trade: 0, is_option_trade: 0, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'split', business_event_kind: 'corporate_action', affects_portfolio: 1, affects_financial: 0, inventory_movement_type: 'split', cash_direction: 'none', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 1, requires_cash_account: 0, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 1, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'bonus', business_event_kind: 'corporate_action', affects_portfolio: 1, affects_financial: 0, inventory_movement_type: 'bonus', cash_direction: 'none', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 1, requires_cash_account: 0, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 1, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'revaluation', business_event_kind: 'corporate_action', affects_portfolio: 1, affects_financial: 0, inventory_movement_type: 'revaluation', cash_direction: 'none', default_financial_status: 'cleared', uses_settlement_rules: 0, requires_instrument: 1, requires_cash_account: 0, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 0, is_corporate_action: 1, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'put_sell', business_event_kind: 'broker_note_option', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'disposition', cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 1, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 1, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'put_buy', business_event_kind: 'broker_note_option', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'acquisition', cash_direction: 'out', default_financial_status: 'cleared', uses_settlement_rules: 1, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 1, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'call_sell', business_event_kind: 'broker_note_option', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'disposition', cash_direction: 'in', default_financial_status: 'cleared', uses_settlement_rules: 1, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 1, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'call_buy', business_event_kind: 'broker_note_option', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'acquisition', cash_direction: 'out', default_financial_status: 'cleared', uses_settlement_rules: 1, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 1, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 },
    { operation_code: 'option_exercise', business_event_kind: 'broker_note_option', affects_portfolio: 1, affects_financial: 1, inventory_movement_type: 'signed_quantity', cash_direction: 'signed', default_financial_status: 'cleared', uses_settlement_rules: 1, requires_instrument: 1, requires_cash_account: 1, is_external_flow_for_twr: 0, is_trade: 0, is_option_trade: 1, is_corporate_action: 0, is_passive_income: 0, is_passive_expense: 0, is_opening: 0, is_active: 1 }
  ];

  for (const pol of policies) {
    await gw.insert(ctx, 'invest_operation_policies', pol);
  }

  // Cash policy seeds
  await gw.insert(ctx, 'invest_brokers', {
    code: 'BTG',
    name: 'BTG Pactual',
    country_code: 'BR',
    is_active: 1
  });

  await gw.insert(ctx, 'invest_cash_account_policies', {
    id: 'icap-btg-brl-default',
    org_id: ctx.organizationId,
    broker_code: 'BTG',
    currency_code: 'BRL',
    cash_ticker: 'CAIXA-BTG',
    cash_name: 'BTG Pactual',
    financial_account_type: 'brokerage',
    financial_account_external_id: 'BTG-BRL',
    is_default_for_currency: 1,
    is_active: 1,
    valid_from: '1900-01-01'
  });
}
