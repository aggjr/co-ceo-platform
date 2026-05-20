import { createSignal, onMount, For, Show } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { loadVisibleMenu } from '../../navigation/buildVisibleMenu.js';

interface MenuItem {
  label: string;
  path: string;
}

interface MenuModule {
  id: string;
  label: string;
  items: MenuItem[];
}

export function SideNav() {
  const [modules, setModules] = createSignal<MenuModule[]>([]);
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const location = useLocation();
  const navigate = useNavigate();

  onMount(async () => {
    try {
      const menu = await loadVisibleMenu();
      setModules(menu);

      // Autoexpandir o módulo que contém a rota atual
      const current = location.pathname;
      const initialExpanded: Record<string, boolean> = {};

      menu.forEach((mod: MenuModule) => {
        const hasActive = mod.items.some((item) => pathMatches(current, item.path));
        initialExpanded[mod.id] = hasActive;
      });
      setExpanded(initialExpanded);
    } catch (err) {
      console.error('Erro ao carregar menu lateral:', err);
    }
  });

  const pathMatches = (currentPath: string, itemPath: string) => {
    if (currentPath === itemPath) return true;
    if (itemPath !== '/' && currentPath.startsWith(`${itemPath}/`)) return true;
    return false;
  };

  const isPathActive = (currentPath: string, itemPath: string, allPaths: string[]) => {
    if (!pathMatches(currentPath, itemPath)) return false;
    return !allPaths.some(
      (other) =>
        other !== itemPath &&
        other.startsWith(`${itemPath}/`) &&
        pathMatches(currentPath, other)
    );
  };

  const toggleModule = (moduleId: string) => {
    setExpanded((prev) => ({
      ...prev,
      [moduleId]: !prev[moduleId],
    }));
  };

  return (
    <nav class="side-nav" aria-label="Módulos">
      <Show
        when={modules().length > 0}
        fallback={<p class="nav-empty">Nenhum módulo disponível.</p>}
      >
        <For each={modules()}>
          {(mod) => {
            const allPaths = mod.items.map((i) => i.path);
            const isOpen = () => !!expanded()[mod.id];

            return (
              <div class="nav-module" data-module-id={mod.id}>
                <button
                  type="button"
                  class="nav-module-toggle"
                  aria-expanded={isOpen() ? 'true' : 'false'}
                  onClick={() => toggleModule(mod.id)}
                >
                  <span class="nav-chevron">{isOpen() ? '▼' : '▶'}</span>
                  <span class="nav-module-label">{mod.label}</span>
                </button>
                <div class="nav-module-items" hidden={!isOpen()}>
                  <For each={mod.items}>
                    {(item) => {
                      const isActive = () => isPathActive(location.pathname, item.path, allPaths);
                      return (
                        <a
                          href={item.path}
                          class="nav-link"
                          classList={{ active: isActive() }}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(item.path);
                          }}
                        >
                          {item.label}
                        </a>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </Show>
    </nav>
  );
}
