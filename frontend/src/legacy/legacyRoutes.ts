import type { LegacyPageLoader } from './LegacyRouteHost';
import { LoginPage } from '../pages/LoginPage.js';
import { CockpitWelcomePage } from '../pages/CockpitWelcomePage.js';
import { PlatformCockpitPage } from '../pages/PlatformCockpitPage.js';
import { ClientCockpitPage } from '../pages/ClientCockpitPage.js';
import { InvestDashboardPage } from '../pages/InvestDashboardPage.js';
import { InvestPortfolioPage } from '../pages/InvestPortfolioPage.js';
import { InvestStockGainPivotPage } from '../pages/InvestStockGainPivotPage.js';
import { InvestBrokerageNotesPage } from '../pages/InvestBrokerageNotesPage.js';
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
  { path: '/invest/portfolio', loader: InvestPortfolioPage },
  { path: '/invest/carteira-acoes-fiis', loader: InvestPortfolioPage },
  { path: '/invest/resultado', loader: InvestPortfolioPage },
  { path: '/invest/ganhos-por-acao', loader: InvestStockGainPivotPage },
  { path: '/invest/notas-corretagem', loader: InvestBrokerageNotesPage },
  { path: '/invest/extratos', loader: InvestExtratosPage },
  { path: '/invest/transacoes-finalizadas', loader: InvestPortfolioPage },
];
