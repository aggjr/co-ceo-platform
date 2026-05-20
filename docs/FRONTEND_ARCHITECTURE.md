# Frontend — SolidJS (migração gradual)

## Visão

O shell da aplicação usa **SolidJS** + **@solidjs/router**. As telas ainda em JavaScript legado são montadas via **LegacyRouteHost** (padrão strangler), preservando `portfolioDisplay.js`, `renderShell` e toda a lógica INVEST até serem portadas para componentes TSX.

## Entrada

- `frontend/index.html` → `src/main.tsx`
- `main.js` permanece no repositório como referência histórica; não é mais o entry de produção.

## Rotas

Definidas em `src/legacy/legacyRoutes.ts` (paridade com o antigo `main.js`).

| Tipo | Wrapper | Conteúdo |
|------|---------|----------|
| `/login` | nenhum | `LegacyRouteHost` → `LoginPage.js` (tela cheia) |
| Demais rotas | `Shell.tsx` (Solid) | `LegacyRouteHost` → página `.js` + `renderShell()` só no slot `.content` |

`renderShell` (`components/Shell.js`) **não** reconstrói sidebar/header — apenas `setPageTitle` + `innerHTML` no container legado.

Evitar: `<Route path="/" component={Shell}>` com filhos sem `<Outlet />` (deixa a tela em branco). Usar `protectedLegacy()` em `shell/protectedLegacy.tsx`.

Para migrar uma tela:

1. Reimplementar a página em `src/pages/*.tsx` com dados reais (`api/client.js`).
2. Substituir o `loader` legado na entrada correspondente em `legacyRoutes.ts` por um componente Solid nativo.
3. Extrair lógica de domínio para módulos testáveis (`src/domain/invest/`).

## Navegação

`router.js` exporta `navigate()` usado pelo código legado. Com Solid ativo, `bindSolidNavigate` (em `shell/NavigateBridge.tsx`) delega ao router.

## Próximas etapas (roadmap)

| Etapa | Escopo |
|-------|--------|
| 1 ✅ | Shell Solid + rotas legadas (sem perder invest/portfolio) |
| 2 | Login + Shell em TSX (impersonation, menu dinâmico) |
| 3 | Portfólio: quebrar `portfolioDisplay.js` em componentes + tipos |
| 4 | Resultado, pivot, transações finalizadas |
| 5 | Testes de componente (Vitest + @solidjs/testing-library) |

## Componentes novos reutilizáveis

- `components/excel/ExcelTable.tsx` — tabelas ordenáveis (substituir gradualmente `coCeoExcelGrid` onde fizer sentido).

## Build

```bash
npm run dev:web
npm run build:web
```
