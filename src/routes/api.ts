import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { CockpitController } from '../controllers/CockpitController';
import { createTelemetryController } from '../controllers/TelemetryController';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { requirePermission } from '../middlewares/RequirePermission';
import { requireAnyPermission } from '../middlewares/RequireAnyPermission';
import { dataGateway } from '../config/gateway';
import { QualityController } from '../controllers/QualityController';
import { InvestController } from '../controllers/InvestController';

const router = Router();
const gateway = dataGateway;
const cockpit = new CockpitController(gateway);
const invest = new InvestController(gateway);
const telemetry = createTelemetryController(gateway);

// --- Auth ---
router.post('/auth/login', AuthController.login);
router.post('/auth/select-context', AuthController.selectContext);
router.get('/auth/me', AuthMiddleware.protect, AuthController.me);
router.post('/auth/impersonate', AuthMiddleware.protect, AuthController.impersonate);

// --- Telemetria (qualquer usuário autenticado) ---
router.post('/telemetry/events', AuthMiddleware.protect, telemetry.ingest);

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
  '/invest/portfolio',
  AuthMiddleware.protect,
  requirePermission('invest:custody:read'),
  invest.listPortfolio.bind(invest)
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
  '/invest/custody/reconcile',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.reconcileCustody.bind(invest)
);
router.post(
  '/invest/custody/apply-corrections',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.applyCustodyCorrections.bind(invest)
);
router.post(
  '/invest/pending-settlement/sync',
  AuthMiddleware.protect,
  requirePermission('invest:ledger:write'),
  invest.syncPendingSettlements.bind(invest)
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

export default router;
