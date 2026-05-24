import { onMount, onCleanup, createEffect } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { trackScreenView } from '../telemetry/index.js';

export type LegacyPageLoader = (container: HTMLElement) => void | Promise<void>;

/** Monta páginas JS legadas (renderShell + portfolioDisplay) dentro do shell Solid. */
export function LegacyRouteHost(props: { loader: LegacyPageLoader }) {
  let root: HTMLDivElement | undefined;
  const location = useLocation();

  const run = async () => {
    if (!root) {
      console.log('[LegacyRouteHost] run aborted: root is null/undefined');
      return;
    }
    console.log('[LegacyRouteHost] run starting for loader', props.loader, 'at path', location.pathname);
    const loader = document.getElementById('app-loader');
    if (loader) loader.style.display = 'none';
    root.innerHTML = '';
    try {
      await props.loader(root);
      console.log('[LegacyRouteHost] loader finished successfully');
      const path = window.location.pathname === '/' ? '/login' : window.location.pathname;
      trackScreenView(path);
    } catch (err) {
      console.error('[LegacyRouteHost] loader threw error:', err);
      const message = err instanceof Error ? err.message : 'Erro ao carregar página.';
      root.innerHTML = `<div class="error-banner">${message}</div>`;
    }
  };

  const onRefresh = () => void run();

  createEffect(() => {
    // Re-run loader whenever the route path changes or the loader prop changes
    const currentPath = location.pathname;
    void run();
  });

  onMount(() => {
    window.addEventListener('coceo:route-refresh', onRefresh);
  });

  onCleanup(() => {
    window.removeEventListener('coceo:route-refresh', onRefresh);
    if (root) root.innerHTML = '';
  });

  return <div ref={root!} class="legacy-route-root" />;
}

export function legacyPage(loader: LegacyPageLoader) {
  return () => <LegacyRouteHost loader={loader} />;
}
