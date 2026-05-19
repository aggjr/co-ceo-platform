import { SecurityScopeResolver } from '../../../src/core/dal/SecurityScope';
import { GatewayError } from '../../../src/core/dal/errors';

describe('SecurityScopeResolver', () => {
  it('rejeita path com caracteres perigosos para LIKE', () => {
    expect(() => SecurityScopeResolver.validatePath('/org%/evil/')).toThrow(GatewayError);
  });

  it('aceita path materializado válido', () => {
    expect(() => SecurityScopeResolver.validatePath('/uuid-org-1/uuid-org-2/')).not.toThrow();
  });

  it('global scope retorna cláusula aberta', () => {
    const clause = SecurityScopeResolver.buildTenantScopeClause(
      { userId: 'a', organizationId: null, impersonatorId: null, scope: 'global' },
      null
    );
    expect(clause.sql).toBe('1=1');
    expect(clause.params).toHaveLength(0);
  });

  it('node scope usa LIKE parametrizado', () => {
    const clause = SecurityScopeResolver.buildTenantScopeClause(
      {
        userId: 'a',
        organizationId: 'org-1',
        impersonatorId: 'admin-1',
        scope: 'node',
      },
      '/org-root/org-child/'
    );
    expect(clause.sql).toContain('path LIKE ?');
    expect(clause.params).toEqual(['/org-root/org-child/%']);
  });
});
