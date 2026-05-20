import { For } from 'solid-js';
import { Navigate, Route, Router, Routes } from '@solidjs/router';
import { legacyPage } from './legacy/LegacyRouteHost';
import { LEGACY_ROUTES } from './legacy/legacyRoutes';
import { NavigateBridge } from './shell/NavigateBridge';
import { protectedLegacy } from './shell/protectedLegacy';

const PUBLIC_ROUTES = new Set(['/login']);

export function App() {
  const authRoutes = LEGACY_ROUTES.filter((r) => !PUBLIC_ROUTES.has(r.path));
  const loginRoute = LEGACY_ROUTES.find((r) => r.path === '/login');

  return (
    <Router>
      <NavigateBridge />
      <Routes>
        {loginRoute ? (
          <Route path="/login" component={legacyPage(loginRoute.loader)} />
        ) : null}

        <For each={authRoutes}>
          {(def) => (
            <Route path={def.path} component={protectedLegacy(def.loader)} />
          )}
        </For>

        <Route path="/" component={() => <Navigate href="/login" />} />
        <Route path="*" component={() => <Navigate href="/login" />} />
      </Routes>
    </Router>
  );
}
