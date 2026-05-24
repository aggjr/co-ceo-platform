import { onMount, onCleanup, createEffect } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { trackScreenView } from '../telemetry/index.js';

export type LegacyPageLoader = (container: HTMLElement, currentPath?: string) => void | Promise<void>;

/** Monta páginas JS legadas (renderShell + portfolioDisplay) dentro do shell Solid. */
export function LegacyRouteHost(props: { loader: LegacyPageLoader }) {
  let containerRef: HTMLDivElement | undefined;
  const location = useLocation();
  let activeRoot: HTMLDivElement | null = null;

  const run = async () => {
    if (!containerRef) {
      console.log('[LegacyRouteHost] run aborted: containerRef is null/undefined');
      return;
    }
    
    // Create a fresh detached wrapper for this execution
    const newRoot = document.createElement('div');
    newRoot.className = 'legacy-route-active';
    activeRoot = newRoot;
    
    // Clear container and attach the new root
    containerRef.innerHTML = '';
    containerRef.appendChild(newRoot);

    console.log('[LegacyRouteHost] run starting for loader', props.loader, 'at path', location.pathname);
    const loader = document.getElementById('app-loader');
    if (loader) loader.style.display = 'none';
    
    try {
      await props.loader(newRoot, location.pathname);
      
      console.log('[LegacyRouteHost] loader finished for path', location.pathname);
      
      // Se este run não for o mais recente, descartamos as ações pós-carregamento.
      if (activeRoot === newRoot) {
        const path = window.location.pathname === '/' ? '/login' : window.location.pathname;
        trackScreenView(path);
      } else {
        console.warn(`[LegacyRouteHost] race condition prevented for path ${location.pathname}`);
      }
    } catch (err) {
      console.error('[LegacyRouteHost] loader threw error:', err);
      if (activeRoot === newRoot) {
        const message = err instanceof Error ? err.message : 'Erro ao carregar página.';
        newRoot.innerHTML = `<div class="error-banner">${message}</div>`;
      }
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
    if (containerRef) containerRef.innerHTML = '';
  });

  return <div ref={containerRef!} class="legacy-route-host" />;
}

export function legacyPage(loader: LegacyPageLoader) {
  return () => <LegacyRouteHost loader={loader} />;
}
