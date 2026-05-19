import { GATEWAY_READ_QUERIES } from '../../../src/core/dal/GatewayReadQueries';
import { authBootstrapContext } from '../../../src/core/auth/authBootstrapContext';
import { SYSTEM_INSTALLER_USER_ID } from '../../../src/core/dal';

describe('AuthRepository gateway', () => {
  it('registra consultas de bootstrap no catálogo', () => {
    expect(GATEWAY_READ_QUERIES.auth_user_by_email.bootstrapOnly).toBe(true);
    expect(GATEWAY_READ_QUERIES.auth_user_contexts.bootstrapOnly).toBe(true);
    expect(GATEWAY_READ_QUERIES.auth_role_permissions.bootstrapOnly).toBe(true);
    expect(GATEWAY_READ_QUERIES.cockpit_role_permissions.bootstrapOnly).toBeUndefined();
  });

  it('authBootstrapContext usa SYSTEM_INSTALLER global', () => {
    const ctx = authBootstrapContext();
    expect(ctx.userId).toBe(SYSTEM_INSTALLER_USER_ID);
    expect(ctx.scope).toBe('global');
    expect(ctx.organizationId).toBeNull();
  });
});
