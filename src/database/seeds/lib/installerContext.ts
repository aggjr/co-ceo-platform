import type { UserContext } from '../../../core/dal';
import { authBootstrapContext } from '../../../core/auth/authBootstrapContext';

/** Seeds administrativos — mesmo contexto que bootstrap de auth. */
export function installerContext(): UserContext {
  return authBootstrapContext();
}
