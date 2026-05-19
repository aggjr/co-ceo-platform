import { Request, Response, NextFunction } from 'express';
import { requireAnyPermission } from '../../src/middlewares/RequireAnyPermission';
import { AuthorizationService } from '../../src/core/auth/AuthorizationService';

jest.mock('../../src/core/auth/AuthorizationService');

describe('requireAnyPermission', () => {
  const next = jest.fn() as NextFunction;
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res = { status } as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('permite quando uma das permissões é concedida', async () => {
    (AuthorizationService.assertCan as jest.Mock)
      .mockRejectedValueOnce(new Error('negado'))
      .mockResolvedValueOnce(undefined);

    const req = { userContext: { userId: 'u1' } } as Request;
    const middleware = requireAnyPermission('cockpit:iam:read', 'cockpit:impersonate:execute');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('nega quando nenhuma permissão é concedida', async () => {
    (AuthorizationService.assertCan as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Permissão negada.'), { httpStatus: 403 })
    );

    const req = { userContext: { userId: 'u1' } } as Request;
    const middleware = requireAnyPermission('cockpit:impersonate:execute');
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
