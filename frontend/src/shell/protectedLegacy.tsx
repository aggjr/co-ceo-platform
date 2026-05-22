import { Navigate } from '@solidjs/router';
import { isAuthenticated } from '../auth/session.js';
import { Shell } from '../components/layout/Shell';
import { LegacyRouteHost, type LegacyPageLoader } from '../legacy/LegacyRouteHost';

/** Rota autenticada: Shell Solid (menu/header) + conteúdo legado no slot central. */
export function protectedLegacy(loader: LegacyPageLoader) {
  return () => {
    if (!isAuthenticated()) {
      return <Navigate href="/login" />;
    }
    return (
      <Shell>
        <LegacyRouteHost loader={loader} />
      </Shell>
    );
  };
}
