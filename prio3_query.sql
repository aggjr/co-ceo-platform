SELECT transaction_type, quantity_delta, total_net_value, unit_price FROM patrimony_ledger_entries WHERE patrimony_item_id IN (SELECT id FROM patrimony_items WHERE identifier='PRIO3');
