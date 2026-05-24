-- Caminhos canônicos: Ações/FIIs -> /invest/portfolio, Opções -> /invest/opcoes
UPDATE ui_menu_nodes
SET path = '/invest/portfolio',
    updated_at = CURRENT_TIMESTAMP(3)
WHERE code = 'invest.portfolio';

UPDATE ui_menu_nodes
SET path = '/invest/opcoes',
    updated_at = CURRENT_TIMESTAMP(3)
WHERE code = 'invest.options';
