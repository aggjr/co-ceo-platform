-- Remove do menu lateral telas legadas de importação/extrato (substituídas por Conciliação).
UPDATE ui_menu_nodes
SET is_active = 0
WHERE code IN ('invest.extratos', 'invest.importacao')
   OR path IN (
        '/invest/extratos',
        '/invest/importacao',
        '/invest/importacao-mes'
      );
