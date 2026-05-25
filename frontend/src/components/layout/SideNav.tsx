import { createSignal, onMount, For, Show } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { loadVisibleMenu } from '../../navigation/buildVisibleMenu.js';

interface MenuItem {
  label: string;
  path: string;
  children?: MenuItem[];
}

interface MenuModule {
  id: string;
  label: string;
  items: MenuItem[];
}

function collectPaths(items: MenuItem[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    paths.push(item.path);
    if (item.children?.length) {
      for (const child of item.children) paths.push(child.path);
    }
  }
  return paths;
}

function itemOrChildActive(item: MenuItem, currentPath: string, allPaths: string[]) {
  if (isPathActive(currentPath, item.path, allPaths)) return true;
  if (!item.children?.length) return false;
  return item.children.some((c) => isPathActive(currentPath, c.path, allPaths));
}

function pathMatches(currentPath: string, itemPath: string) {
  if (currentPath === itemPath) return true;
  if (itemPath !== '/' && currentPath.startsWith(`${itemPath}/`)) return true;
  return false;
}

function isPathActive(currentPath: string, itemPath: string, allPaths: string[]) {
  if (!pathMatches(currentPath, itemPath)) return false;
  return !allPaths.some(
    (other) =>
      other !== itemPath &&
      other.startsWith(`${itemPath}/`) &&
      pathMatches(currentPath, other),
  );
}

export function SideNav() {
  const [modules, setModules] = createSignal<MenuModule[]>([]);
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [expandedSubgroups, setExpandedSubgroups] = createSignal<Record<string, boolean>>({});
  const location = useLocation();
  const navigate = useNavigate();

  onMount(async () => {
    try {
      const menu = await loadVisibleMenu();
      setModules(menu);

      const current = location.pathname;
      const initialExpanded: Record<string, boolean> = {};
      const initialExpandedSubgroups: Record<string, boolean> = {};

      menu.forEach((mod: MenuModule) => {
        const allPaths = collectPaths(mod.items);
        const hasActive = mod.items.some((item) =>
          itemOrChildActive(item, current, allPaths),
        );
        initialExpanded[mod.id] = hasActive;

        mod.items.forEach((item) => {
          if (item.children?.length) {
            initialExpandedSubgroups[item.path] = item.children.some(c => isPathActive(current, c.path, allPaths));
          }
        });
      });
      setExpanded(initialExpanded);
      setExpandedSubgroups(initialExpandedSubgroups);
    } catch (err) {
      console.error('Erro ao carregar menu lateral:', err);
    }
  });

  const toggleModule = (moduleId: string) => {
    setExpanded((prev) => ({
      ...prev,
      [moduleId]: !prev[moduleId],
    }));
  };

  const toggleSubgroup = (path: string) => {
    setExpandedSubgroups((prev) => ({
      ...prev,
      [path]: !prev[path],
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
            const allPaths = collectPaths(mod.items);
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
                    {(item) => (
                      <Show
                        when={item.children?.length}
                        fallback={
                          <a
                            href={item.path}
                            class="nav-link"
                            classList={{
                              active: isPathActive(location.pathname, item.path, allPaths),
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(item.path);
                            }}
                          >
                            {item.label}
                          </a>
                        }
                      >
                        <div class="nav-subgroup" data-item-path={item.path}>
                          <button
                            type="button"
                            class="nav-subgroup-toggle"
                            aria-expanded={expandedSubgroups()[item.path] ? 'true' : 'false'}
                            onClick={() => toggleSubgroup(item.path)}
                          >
                            <span class="nav-chevron">{expandedSubgroups()[item.path] ? '▼' : '▶'}</span>
                            <span class="nav-subgroup-label">{item.label}</span>
                          </button>
                          <div class="nav-subgroup-items" hidden={!expandedSubgroups()[item.path]}>
                            <For each={item.children!}>
                              {(child) => (
                                <a
                                  href={child.path}
                                  class="nav-link nav-link--child"
                                  classList={{
                                    active: isPathActive(
                                      location.pathname,
                                      child.path,
                                      allPaths,
                                    ),
                                  }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    navigate(child.path);
                                  }}
                                >
                                  {child.label}
                                </a>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    )}
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
