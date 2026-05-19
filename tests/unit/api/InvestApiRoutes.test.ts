import apiRouter from '../../../src/routes/api';
import {
  createApiTestApp,
  httpRequest,
  listExpressRoutes,
} from '../../helpers/expressRouteUtils';

describe('API INVEST — rotas e erros HTTP', () => {
  const routes = listExpressRoutes(apiRouter);

  it('registra GET /invest/patrimony-daily (evita 404 por build desatualizado)', () => {
    const hit = routes.find(
      (r) => r.method === 'GET' && r.path === '/invest/patrimony-daily'
    );
    expect(hit).toBeDefined();
  });

  it('registra demais endpoints INVEST usados pela UI', () => {
    const paths = routes.filter((r) => r.path.startsWith('/invest')).map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/invest/portfolio',
        '/invest/pnl-pivot',
        '/invest/patrimony-daily',
        '/invest/ledger/import',
        '/invest/custody/reconcile',
        '/invest/pending-settlement/sync',
      ])
    );
  });

  describe('comportamento HTTP (app espelha index.ts)', () => {
    const app = createApiTestApp(apiRouter);

    it('GET /api/invest/patrimony-daily sem token retorna 401 (não 404)', async () => {
      const res = await httpRequest(app, 'GET', '/api/invest/patrimony-daily?from=2026-01-01&to=2026-01-31');
      expect(res.status).toBe(401);
      expect(res.body?.success).toBe(false);
    });

    it('GET /api/rota-inexistente retorna 404 JSON explícito', async () => {
      const res = await httpRequest(app, 'GET', '/api/invest/nao-existe');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: 'Endpoint não encontrado.',
      });
    });
  });
});
