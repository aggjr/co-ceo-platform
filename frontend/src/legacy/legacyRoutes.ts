import type { LegacyPageLoader } from './LegacyRouteHost';
import { LoginPage } from '../pages/LoginPage.js';
import { CockpitWelcomePage } from '../pages/CockpitWelcomePage.js';
import { PlatformCockpitPage } from '../pages/PlatformCockpitPage.js';
import { ClientCockpitPage } from '../pages/ClientCockpitPage.js';
import { InvestDashboardPage } from '../pages/InvestDashboardPage.js';
import { InvestPortfolioPage } from '../pages/InvestPortfolioPage.js';
import {
  InvestEquitiesPage,
  InvestOptionsPage,
  InvestFixedIncomePage,
} from '../pages/InvestPortfolioPage.js';
import { InvestStockGainPivotPage } from '../pages/InvestStockGainPivotPage.js';
import { InvestHistoricoOperacoesPage } from '../pages/InvestHistoricoOperacoesPage.js';
import { InvestExtratosPage } from '../pages/InvestExtratosPage.js';
import { QualityRegressionPage } from '../pages/QualityRegressionPage.js';

export type LegacyRouteDef = {
  path: string;
  loader: LegacyPageLoader;
};

/** Paridade com main.js — migrar cada rota para TSX aos poucos. */
export const LEGACY_ROUTES: LegacyRouteDef[] = [
  { path: '/login', loader: LoginPage },
  { path: '/cockpit', loader: CockpitWelcomePage },
  { path: '/cockpit/platform', loader: PlatformCockpitPage },
  { path: '/cockpit/platform/quality', loader: QualityRegressionPage },
  { path: '/cockpit/client', loader: ClientCockpitPage },
  { path: '/cockpit/client/team', loader: ClientCockpitPage },
  { path: '/cockpit/client/roles', loader: ClientCockpitPage },
  { path: '/cockpit/client/storage', loader: ClientCockpitPage },
  { path: '/invest', loader: InvestDashboardPage },
  { path: '/invest/portfolio', loader: InvestEquitiesPage },
  { path: '/invest/opcoes', loader: InvestOptionsPage },
  { path: '/invest/titulos', loader: InvestFixedIncomePage },
  { path: '/invest/carteira-acoes-fiis', loader: InvestEquitiesPage },
  { path: '/invest/resultado', loader: InvestPortfolioPage },
  { path: '/invest/ganhos-por-acao', loader: InvestStockGainPivotPage },
  { path: '/invest/historico-operacoes', loader: InvestHistoricoOperacoesPage },
  { path: '/invest/extratos', loader: InvestExtratosPage },
  { path: '/invest/transacoes-finalizadas', loader: InvestPortfolioPage },
];
