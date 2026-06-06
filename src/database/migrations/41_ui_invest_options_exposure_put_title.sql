-- Títulos das tabelas PUT/CALL na tela Exposição notional
UPDATE ui_text_catalog
SET default_text = 'PUTs - Valores Necessários no próximo Exercício'
WHERE text_key = 'screen.invest.options.exposure.put_title'
  AND locale = 'pt-BR';

UPDATE ui_text_catalog
SET default_text = 'CALLs - Valores possíveis de serem gerados no proximo Strike'
WHERE text_key = 'screen.invest.options.exposure.call_title'
  AND locale = 'pt-BR';
