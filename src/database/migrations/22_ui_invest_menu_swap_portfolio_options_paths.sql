-- Corrige apontamento invertido: Acoes/FIIs <-> Opcoes no menu lateral.
UPDATE ui_menu_nodes
SET path = '/invest/opcoes',
    updated_at = CURRENT_TIMESTAMP(3)
WHERE code = 'invest.portfolio';

UPDATE ui_menu_nodes
SET path = '/invest/portfolio',
    updated_at = CURRENT_TIMESTAMP(3)
WHERE code = 'invest.options';
