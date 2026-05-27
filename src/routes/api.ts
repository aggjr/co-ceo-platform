import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AuthController } from '../controllers/AuthController';
import { CockpitController } from '../controllers/CockpitController';
import { createTelemetryController } from '../controllers/TelemetryController';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { requirePermission } from '../middlewares/RequirePermission';
import { requireAnyPermission } from '../middlewares/RequireAnyPermission';
import { dataGateway } from '../config/gateway';
import { QualityController } from '../controllers/QualityController';
import { InvestController } from '../controllers/InvestController';
import { UiManifestController } from '../controllers/UiManifestController';
import { PlatformAlertsController } from '../controllers/PlatformAlertsController';
import { PlatformDeployController } from '../controllers/PlatformDeployController';

const router = Router();
const gateway = dataGateway;
const cockpit = new CockpitController(gateway);
const invest = new InvestController(gateway);
const platformAlerts = new PlatformAlertsController(gateway);
const platformDeploy = new PlatformDeployController();
const telemetry = createTelemetryController(gateway);
const uiManifest = new UiManifestController(gateway);

// --- Auth ---
router.post('/auth/login', AuthController.login);
router.post('/auth/select-context', AuthController.selectContext);
router.get('/auth/me', AuthMiddleware.protect, AuthController.me);
router.post('/auth/impersonate', AuthMiddleware.protect, AuthController.impersonate);

// --- Telemetria (qualquer usuário autenticado) ---
router.post('/telemetry/events', AuthMiddleware.protect, telemetry.ingest);

// --- UI manifest (menu + textos resolvidos para o tenant) ---
router.get('/ui/manifest', AuthMiddleware.protect, uiManifest.getManifest);
router.post(
  '/platform/ui-catalog/apply',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  uiManifest.applyCatalog
);
router.get(
  '/platform/deploy/status',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  platformDeploy.getStatus
);
router.post(
  '/platform/deploy/production',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  platformDeploy.triggerProduction
);

// --- Cockpit plataforma (co-CEO) ---
router.get(
  '/cockpit/platform/org-tree',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  requirePermission('cockpit:contracts:read'),
  CockpitController.listPlatformOrgTree
);
router.get(
  '/cockpit/platform/impersonation-targets',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  requirePermission('core:impersonate:execute'),
  CockpitController.listPlatformImpersonationTargets
);
router.get(
  '/cockpit/platform/contracts',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  requirePermission('cockpit:contracts:read'),
  CockpitController.listPlatformContracts
);
router.get(
  '/cockpit/platform/contracts/:contractId/iam',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  requirePermission('cockpit:iam:read'),
  CockpitController.getPlatformContractIam
);

// --- Cockpit cliente ---
router.get('/cockpit/me', AuthMiddleware.protect, cockpit.getMe.bind(cockpit));
router.get(
  '/cockpit/me/org-tree',
  AuthMiddleware.protect,
  requireAnyPermission('cockpit:impersonate:execute', 'cockpit:iam:read'),
  cockpit.listMeOrgTree.bind(cockpit)
);
router.get(
  '/cockpit/me/impersonation-targets',
  AuthMiddleware.protect,
  requirePermission('cockpit:impersonate:execute'),
  cockpit.listMeImpersonationTargets.bind(cockpit)
);
router.get(
  '/cockpit/me/access-matrix',
  AuthMiddleware.protect,
  cockpit.getMeAccessMatrix.bind(cockpit)
);
router.get(
  '/cockpit/me/team',
  AuthMiddleware.protect,
  requirePermission('cockpit:team:read'),
  cockpit.getMeTeam.bind(cockpit)
);
router.get(
  '/cockpit/me/roles',
  AuthMiddleware.protect,
  requirePermission('cockpit:iam:read'),
  cockpit.getMeRoles.bind(cockpit)
);
router.get(
  '/cockpit/me/contract-modules',
  AuthMiddleware.protect,
  cockpit.getMeContractModules.bind(cockpit)
);
router.get(
  '/cockpit/me/storage',
  AuthMiddleware.protect,
  requirePermission('cockpit:storage:read'),
  async (req, res) => {
    const ctx = req.userContext!;
    if (!ctx.organizationId) {
      return res.status(400).json({ success: false, error: 'Sem organização no contexto.' });
    }
    const storage = await gateway.getOrganizationStorage(ctx, ctx.organizationId);
    return res.json({ success: true, storage });
  }
);

// --- Alertas de jobs agendados (equipe co-CEO) ---
router.get(
  '/platform/job-alerts',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  platformAlerts.listUnread.bind(platformAlerts)
);
router.post(
  '/platform/job-alerts/:alertId/acknowledge',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  platformAlerts.acknowledge.bind(platformAlerts)
);

// --- Qualidade / regressão (plataforma) ---
router.get(
  '/quality/regression/dashboard',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  requirePermission('quality:regression:read'),
  QualityController.getDashboard
);
router.get(
  '/quality/regression/impact-plan',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  requirePermission('quality:regression:read'),
  QualityController.getImpactPlan
);
router.post(
  '/quality/regression/run',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  requirePermission('quality:regression:execute'),
  QualityController.runRegression
);

// --- INVEST ---
router.get(
  '/invest/ui-context',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:read'),
  invest.getInvestUiContext.bind(invest)
);
router.get(
  '/invest/portfolio',
  AuthMiddleware.protect,
  requirePermission('invest:custody:read'),
  invest.listPortfolio.bind(invest)
);
router.get(
  '/invest/options/strike-ladder',
  AuthMiddleware.protect,
  requirePermission('invest:custody:read'),
  invest.getOptionStrikeLadder.bind(invest)
);
router.get(
  '/invest/pnl-pivot',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:read'),
  invest.getPnLPivot.bind(invest)
);
router.get(
  '/invest/stock-gain-pivot',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:read'),
  invest.getStockGainPivot.bind(invest)
);
router.get(
  '/invest/patrimony-daily',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:read'),
  invest.getPatrimonyDaily.bind(invest)
);
router.post(
  '/invest/patrimony-daily/record',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.recordPatrimonyDaily.bind(invest)
);
router.post(
  '/invest/quotes/sync-b3',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.syncB3Quotes.bind(invest)
);
router.post(
  '/invest/market/seed-benchmarks',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  invest.seedMarketBenchmarks.bind(invest)
);
router.post(
  '/invest/market/sync-stocks',
  AuthMiddleware.protect,
  AuthMiddleware.requireGlobalScope,
  invest.syncMarketStocks.bind(invest)
);
router.post(
  '/invest/options/snapshot',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.syncOptionSnapshot.bind(invest)
);
router.post(
  '/invest/ledger/import',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.importLedger.bind(invest)
);
router.post(
  '/invest/import/btg-extract',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.importBtgExtractUpload.bind(invest)
);
router.post(
  '/invest/import/btg-brokerage-notes',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.importBtgBrokerageUpload.bind(invest)
);
router.post(
  '/invest/custody/reconcile',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.reconcileCustody.bind(invest)
);
router.post(
  '/invest/pending-settlement/sync',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.syncPendingSettlements.bind(invest)
);
router.get(
  '/invest/brokerage-notes/review',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:read'),
  invest.listBrokerageNotesReview.bind(invest)
);
router.get(
  '/invest/cash/extract',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:read'),
  invest.getExtract.bind(invest)
);

// --- Core ---
router.get('/core/storage', AuthMiddleware.protect, requirePermission('cockpit:storage:read'), async (req, res) => {
  const ctx = req.userContext!;
  if (!ctx.organizationId) {
    return res.status(400).json({ success: false, error: 'Sem organização.' });
  }
  const storage = await gateway.getOrganizationStorage(ctx, ctx.organizationId);
  return res.json({ success: true, storage });
});

/** Evita uncaughtException quando um handler async rejeita sem try/catch. */
function wrapAsyncRoutes(router: Router): void {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const stackLayer of layer.route.stack) {
      const original = stackLayer.handle as RequestHandler;
      stackLayer.handle = asyncHandler(original as never) as RequestHandler;
    }
  }
}

wrapAsyncRoutes(router);

export default router;
