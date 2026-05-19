# ExcelTable (oficial CO-CEO)

Componente copiado de `C:\co_ceo\coceo_software_template\src\components\ExcelTable.js`.

- **Uso na plataforma:** importar via `frontend/src/lib/coCeoExcelGrid.js` (`mountCoCeoExcelGrids`, `registerCoCeoExcelMount`).
- **Estilos:** `frontend/src/styles/coceo-excel-table.css`
- **API legada:** `frontend/src/lib/excelTable.js` — fachada que delega ao ExcelTable oficial (100% das tabelas do frontend).

Para atualizar a partir do template, copiar de novo `ExcelTable.js`, `GridPreferences.js` e `excel-table.css`, ajustando o import de `getApiBaseUrl` para `../../lib/coCeoApiConfig.js`.
