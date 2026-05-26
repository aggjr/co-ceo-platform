/**
 * Catálogo de navegação — 1º nível = módulo; subitens ligados a rotas e access_resources.
 * Visibilidade filtrada em buildVisibleMenu.js (IAM + contract_modules).
 */
export const MENU_CATALOG = [
  {
    id: 'cockpit',
    label: 'Cockpit',
    moduleCode: 'CORE',
    items: [
      {
        label: 'Contratos',
        path: '/cockpit/platform',
        resourceKey: 'screen.cockpit.platform',
        platformOnly: true,
      },
      {
        label: 'Qualidade',
        path: '/cockpit/platform/quality',
        resourceKey: 'screen.cockpit.quality',
        platformOnly: true,
      },
      {
        label: 'Visão global',
        path: '/cockpit',
        resourceKey: 'screen.cockpit.dashboard',
        platformOnly: true,
      },
      {
        label: 'Minha organização',
        path: '/cockpit/client',
        resourceKey: 'screen.cockpit.dashboard',
        clientOnly: true,
      },
      {
        label: 'Equipe',
        path: '/cockpit/client/team',
        resourceKey: 'screen.cockpit.team',
        clientOnly: true,
      },
      {
        label: 'Papéis',
        path: '/cockpit/client/roles',
        resourceKey: 'screen.cockpit.roles',
        clientOnly: true,
      },
      {
        label: 'Armazenamento',
        path: '/cockpit/client/storage',
        resourceKey: 'screen.cockpit.storage',
        clientOnly: true,
      },
    ],
  },
  {
    id: 'invest',
    label: 'INVEST',
    moduleCode: 'INVEST',
    items: [
      {
        label: 'Resultado histórico',
        path: '/invest',
        resourceKey: 'screen.invest.dashboard',
      },
      {
        label: 'Ações/FIIs',
        path: '/invest/portfolio',
        resourceKey: 'screen.invest.portfolio',
      },
      {
        label: 'Opções',
        path: '/invest/opcoes',
        resourceKey: 'screen.invest.portfolio',
        children: [
          {
            label: 'Tabela Excel',
            path: '/invest/opcoes/tabela',
            resourceKey: 'screen.invest.portfolio',
          },
          {
            label: 'Cards',
            path: '/invest/opcoes/cards',
            resourceKey: 'screen.invest.portfolio',
          },
          {
            label: 'Ampulheta',
            path: '/invest/opcoes/vencimentos',
            resourceKey: 'screen.invest.portfolio',
          },
          {
            label: 'Exposição',
            path: '/invest/opcoes/exposicao',
            resourceKey: 'screen.invest.portfolio',
          },
          {
            label: 'Previsão',
            path: '/invest/opcoes/previsao',
            resourceKey: 'screen.invest.portfolio',
          },
        ],
      },
      {
        label: 'Títulos, RF e CDB',
        path: '/invest/titulos',
        resourceKey: 'screen.invest.portfolio',
      },
      {
        label: 'Resultados por ação',
        path: '/invest/ganhos-por-acao',
        resourceKey: 'screen.invest.results',
      },
      {
        label: 'Histórico de operações',
        path: '/invest/historico-operacoes',
        resourceKey: 'screen.invest.results',
      },
      {
        label: 'Extratos de conta',
        path: '/invest/extratos',
        resourceKey: 'screen.invest.results',
      },
    ],
  },
];
