import { navigate } from '../router.js';

function pathMatches(currentPath, itemPath) {
  if (currentPath === itemPath) return true;
  if (itemPath !== '/' && currentPath.startsWith(`${itemPath}/`)) return true;
  return false;
}

/** Só o item mais específico da rota fica ativo (evita /cockpit + /cockpit/platform juntos). */
export function isPathActive(currentPath, itemPath, allPaths) {
  if (!pathMatches(currentPath, itemPath)) return false;
  return !allPaths.some(
    (other) =>
      other !== itemPath &&
      other.startsWith(`${itemPath}/`) &&
      pathMatches(currentPath, other),
  );
}

function collectMenuPaths(modules) {
  return modules.flatMap((mod) => mod.items.map((item) => item.path));
}

function moduleContainsActive(module, currentPath, allPaths) {
  return module.items.some((item) => isPathActive(currentPath, item.path, allPaths));
}

export function mountSideNav(container, modules, currentPath) {
  container.replaceChildren();

  if (!modules.length) {
    const empty = document.createElement('p');
    empty.className = 'nav-empty';
    empty.textContent = 'Nenhum módulo disponível.';
    container.appendChild(empty);
    return;
  }

  const allPaths = collectMenuPaths(modules);

  modules.forEach((mod) => {
    const expanded = moduleContainsActive(mod, currentPath, allPaths);

    const block = document.createElement('div');
    block.className = 'nav-module';
    block.dataset.moduleId = mod.id;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-module-toggle';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.innerHTML = `<span class="nav-chevron">${expanded ? '▼' : '▶'}</span><span class="nav-module-label">${mod.label}</span>`;

    const sub = document.createElement('div');
    sub.className = 'nav-module-items';
    sub.hidden = !expanded;

    mod.items.forEach((item) => {
      const link = document.createElement('a');
      link.href = item.path;
      link.className = 'nav-link';
      link.dataset.path = item.path;
      link.textContent = item.label;
      if (isPathActive(currentPath, item.path, allPaths)) {
        link.classList.add('active');
      }
      link.addEventListener('click', (e) => {
        e.preventDefault();
        link.blur();
        navigate(item.path);
      });
      sub.appendChild(link);
    });

    toggle.addEventListener('click', () => {
      const open = sub.hidden;
      sub.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('.nav-chevron').textContent = open ? '▼' : '▶';
      toggle.blur();
    });

    block.append(toggle, sub);
    container.appendChild(block);
  });
}
