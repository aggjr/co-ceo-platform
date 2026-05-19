import { AuthService } from '../../../src/core/auth/AuthService';
import type { UserContextOption } from '../../../src/core/auth/AuthRepository';

describe('AuthService.resolveLoginContext', () => {
  const base = (overrides: Partial<UserContextOption>): UserContextOption => ({
    userRoleId: 'ur-1',
    roleId: 'role-1',
    roleCode: 'PLATFORM_SUPER_ADMIN',
    roleName: 'Super Admin',
    scope: 'global',
    contractId: null,
    organizationId: null,
    organizationName: null,
    contractLabel: null,
    isPrimary: false,
    permVersion: 1,
    ...overrides,
  });

  it('deduplica papéis iguais e prioriza escopo global', () => {
    const dup = base({ userRoleId: 'ur-a', isPrimary: true });
    const dup2 = base({ userRoleId: 'ur-b', isPrimary: true });
    const client = base({
      userRoleId: 'ur-c',
      scope: 'node',
      roleCode: 'ORG_OWNER',
      contractId: 'ctr-1',
      organizationId: 'org-1',
    });
    const chosen = AuthService.resolveLoginContext([client, dup, dup2]);
    expect(chosen.scope).toBe('global');
  });
});
