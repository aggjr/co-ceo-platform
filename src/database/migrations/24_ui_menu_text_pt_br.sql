-- Corrige acentuação e capitalização (primeira letra maiúscula) dos rótulos de menu/tela pt-BR.
UPDATE ui_text_catalog SET default_text = 'Visão global' WHERE text_key = 'menu.cockpit.platform_dashboard' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Minha organização' WHERE text_key = 'menu.cockpit.client_dashboard' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Papéis' WHERE text_key = 'menu.cockpit.roles' AND locale = 'pt-BR';

UPDATE ui_text_catalog SET default_text = 'Resultado histórico' WHERE text_key = 'menu.invest.dashboard' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Ações/FIIs' WHERE text_key = 'menu.invest.portfolio' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Opções' WHERE text_key = 'menu.invest.options' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Títulos, RF e CDB' WHERE text_key = 'menu.invest.fixed_income' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Resultados por ação' WHERE text_key = 'menu.invest.stock_gain' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Histórico de operações' WHERE text_key = 'menu.invest.historico_operacoes' AND locale = 'pt-BR';

UPDATE ui_text_catalog SET default_text = 'Resultado histórico' WHERE text_key = 'screen.invest.dashboard.title' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Ações/FIIs' WHERE text_key = 'screen.invest.portfolio.title' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Opções' WHERE text_key = 'screen.invest.options.title' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Títulos, RF e CDB' WHERE text_key = 'screen.invest.fixed_income.title' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Resultados por ação' WHERE text_key = 'screen.invest.stock_gain.title' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Histórico de operações' WHERE text_key = 'screen.invest.historico_operacoes.title' AND locale = 'pt-BR';
UPDATE ui_text_catalog SET default_text = 'Opções finalizadas' WHERE text_key = 'screen.invest.closed_trades.title' AND locale = 'pt-BR';
