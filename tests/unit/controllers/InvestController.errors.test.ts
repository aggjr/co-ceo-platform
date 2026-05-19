import type { Request, Response } from 'express';
import { InvestController } from '../../../src/controllers/InvestController';
import type { CoCeoDataGateway } from '../../../src/core/dal';

jest.mock('../../../src/core/invest/patrimonyAnchors', () => ({
  loadPatrimonyAnchors: () => ({
    monthly: {},
    fixed_income_total: 0,
  }),
}));

function mockRes(): Response {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { status, json } as unknown as Response;
}

describe('InvestController — erros de contexto', () => {
  const gateway = {
    findWhere: jest.fn(),
  } as unknown as CoCeoDataGateway;
  const controller = new InvestController(gateway);

  it('getPatrimonyDaily retorna 400 sem organizationId (personificação obrigatória)', async () => {
    const req = {
      userContext: {
        userId: 'u1',
        organizationId: null,
        impersonatorId: null,
        scope: 'node',
        roleId: 'role-1',
      },
      query: { from: '2026-01-01', to: '2026-01-31' },
    } as unknown as Request;
    const res = mockRes();

    await controller.getPatrimonyDaily(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/organização/i),
      })
    );
  });

  it('listPortfolio retorna 400 sem organizationId', async () => {
    const req = {
      userContext: {
        userId: 'u1',
        organizationId: null,
        impersonatorId: null,
        scope: 'node',
      },
    } as unknown as Request;
    const res = mockRes();

    await controller.listPortfolio(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});
