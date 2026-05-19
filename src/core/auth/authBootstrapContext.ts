import { SYSTEM_INSTALLER_USER_ID, type UserContext } from '../dal/types';

/**
 * Contexto para leituras de login/impersonation antes ou fora do JWT do usuário final.
 * Usa SYSTEM_INSTALLER — somente consultas marcadas bootstrapOnly no catálogo readQuery.
 */
export function authBootstrapContext(): UserContext {
  return {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: null,
    impersonatorId: null,
    scope: 'global',
  };
}
