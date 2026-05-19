import { AuthService } from '../../../src/core/auth/AuthService';
import { AuthRepository } from '../../../src/core/auth/AuthRepository';
import { AuthorizationService } from '../../../src/core/auth/AuthorizationService';
import { OrgScopeService } from '../../../src/core/auth/OrgScopeService';

jest.mock('../../../src/core/auth/AuthRepository');
jest.mock('../../../src/core/auth/AuthorizationService');
jest.mock('../../../src/core/auth/OrgScopeService');

describe('AuthService.impersonate (cliente)', () => {
  const adminCtx = {
    userId: 'admin-1',
    roleId: 'role-owner',
    userRoleId: 'ur-admin',
    contractId: 'ctr-1',
    organizationId: 'org-root',
    impersonatorId: null,
    scope: 'node' as const,
    permVersion: 1,
  };

  const targetCtx = {
    userRoleId: 'ur-target',
    roleId: 'role-viewer',
    roleCode: 'ORG_VIEWER',
    roleName: 'Visualizador',
    scope: 'node' as const,
    contractId: 'ctr-1',
    organizationId: 'org-root',
    organizationName: 'Holding',
    contractLabel: 'Holding',
    isPrimary: true,
    permVersion: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthorizationService.can as jest.Mock).mockImplementation(async (_ctx, code: string) => {
      if (code === 'core:impersonate:execute') return false;
      if (code === 'cockpit:impersonate:execute') {
        return _ctx.userId === 'admin-1';
      }
      return false;
    });
    (AuthRepository.findUserContextById as jest.Mock).mockResolvedValue(targetCtx);
    (AuthRepository.listUserContexts as jest.Mock).mockResolvedValue([targetCtx]);
    (OrgScopeService.assertOrgInSubtree as jest.Mock).mockResolvedValue(undefined);
    jest.spyOn(AuthService, 'selectContext').mockResolvedValue('jwt-token');
  });

  it('permite admin do cliente personificar colaborador na subárvore', async () => {
    const token = await AuthService.impersonate(adminCtx, 'user-target', 'ur-target');
    expect(token).toBe('jwt-token');
    expect(OrgScopeService.assertOrgInSubtree).toHaveBeenCalledWith('org-root', 'org-root');
    expect(AuthService.selectContext).toHaveBeenCalledWith('user-target', 'ur-target', 'admin-1');
  });

  it('bloqueia personificar a si mesmo', async () => {
    await expect(
      AuthService.impersonate(adminCtx, 'admin-1', 'ur-target')
    ).rejects.toMatchObject({ message: 'Não é possível personificar a si mesmo.', httpStatus: 403 });
  });

  it('bloqueia personificar outro administrador com permissão de emulação', async () => {
    (AuthorizationService.can as jest.Mock).mockImplementation(async (_ctx, code: string) => {
      if (code === 'cockpit:impersonate:execute') return true;
      return false;
    });

    await expect(
      AuthService.impersonate(adminCtx, 'user-target', 'ur-target')
    ).rejects.toMatchObject({
      message: 'Não é permitido personificar outro administrador com permissão de emulação.',
      httpStatus: 403,
    });
  });
});
