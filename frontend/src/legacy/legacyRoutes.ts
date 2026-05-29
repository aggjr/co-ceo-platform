import type { LegacyPageLoader } from './LegacyRouteHost';
import { LoginPage } from '../pages/LoginPage.js';
import { CockpitWelcomePage } from '../pages/CockpitWelcomePage.js';
import { PlatformCockpitPage } from '../pages/PlatformCockpitPage.js';
import {
  CockpitClientDashboardPage,
  CockpitTeamPage,
  CockpitRolesPage,
  CockpitStoragePage,
} from '../pages/ClientCockpitPage.js';
import { InvestDashboardPage } from '../pages/InvestDashboardPage.js';
import {
  InvestEquitiesPage,
  InvestOptionsTablePage,
  InvestFixedIncomePage,
} from '../pages/InvestPortfolioPage.js';
import { InvestOptionsRedirectPage } from '../pages/InvestOptionsRedirectPage.js';
import { InvestOptionsCardsPage } from '../pages/InvestOptionsCardsPage.js';
import { InvestOptionsByExpiryPage } from '../pages/InvestOptionsByExpiryPage.js';
import { InvestOptionsExposurePage } from '../pages/InvestOptionsExposurePage.js';
import { InvestPanoramaPage } from '../pages/InvestPanoramaPage.js';
import { InvestResultadoPage } from '../pages/InvestResultadoPage.js';
import { InvestClosedTradesPage } from '../pages/InvestClosedTradesPage.js';
import { InvestStockGainPivotPage } from '../pages/InvestStockGainPivotPage.js';
import { InvestHistoricoOperacoesPage } from '../pages/InvestHistoricoOperacoesPage.js';
import { InvestExtratosPage } from '../pages/InvestExtratosPage.js';
import { InvestImportacaoPage } from '../pages/InvestImportacaoPage.js';
import { InvestImportacaoMesPage } from '../pages/InvestImportacaoMesPage.js';
import { InvestConciliacaoPage } from '../pages/InvestConciliacaoPage.js';
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
  { path: '/cockpit/client', loader: CockpitClientDashboardPage },
  { path: '/cockpit/client/team', loader: CockpitTeamPage },
  { path: '/cockpit/client/roles', loader: CockpitRolesPage },
  { path: '/cockpit/client/storage', loader: CockpitStoragePage },
  { path: '/invest', loader: InvestDashboardPage },
  { path: '/invest/portfolio', loader: InvestEquitiesPage },
  { path: '/invest/panorama', loader: InvestPanoramaPage },
  { path: '/invest/opcoes', loader: InvestOptionsRedirectPage },
  { path: '/invest/opcoes/tabela', loader: InvestOptionsTablePage },
  { path: '/invest/opcoes/cards', loader: InvestOptionsCardsPage },
  { path: '/invest/opcoes/vencimentos', loader: InvestOptionsByExpiryPage },
  { path: '/invest/opcoes/exposicao', loader: InvestOptionsExposurePage },
  { path: '/invest/titulos', loader: InvestFixedIncomePage },
  { path: '/invest/carteira-acoes-fiis', loader: InvestEquitiesPage },
  { path: '/invest/resultado', loader: InvestResultadoPage },
  { path: '/invest/ganhos-por-acao', loader: InvestStockGainPivotPage },
  { path: '/invest/historico-operacoes', loader: InvestHistoricoOperacoesPage },
  { path: '/invest/extratos', loader: InvestExtratosPage },
  { path: '/invest/importacao', loader: InvestImportacaoPage },
  { path: '/invest/importacao-mes', loader: InvestImportacaoMesPage },
  { path: '/invest/conciliacao', loader: InvestConciliacaoPage },
  { path: '/invest/transacoes-finalizadas', loader: InvestClosedTradesPage },
];
