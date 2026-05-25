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

function collectPathsFromItems(items) {
  const paths = [];
  for (const item of items) {
    paths.push(item.path);
    if (item.children?.length) {
      for (const child of item.children) paths.push(child.path);
    }
  }
  return paths;
}

function collectMenuPaths(modules) {
  return modules.flatMap((mod) => collectPathsFromItems(mod.items));
}

function itemOrChildActive(item, currentPath, allPaths) {
  if (isPathActive(currentPath, item.path, allPaths)) return true;
  if (!item.children?.length) return false;
  return item.children.some((c) => isPathActive(currentPath, c.path, allPaths));
}

function moduleContainsActive(module, currentPath, allPaths) {
  return module.items.some((item) => itemOrChildActive(item, currentPath, allPaths));
}

function appendNavLink(parent, { path, label, currentPath, allPaths, indent = false }) {
  const link = document.createElement('a');
  link.href = path;
  link.className = indent ? 'nav-link nav-link--child' : 'nav-link';
  link.dataset.path = path;
  link.textContent = label;
  if (isPathActive(currentPath, path, allPaths)) {
    link.classList.add('active');
  }
  link.addEventListener('click', (e) => {
    e.preventDefault();
    link.blur();
    navigate(path);
  });
  parent.appendChild(link);
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
      if (item.children?.length) {
        const group = document.createElement('div');
        group.className = 'nav-subgroup';
        const label = document.createElement('span');
        label.className = 'nav-subgroup-label';
        label.textContent = item.label;
        group.appendChild(label);
        for (const child of item.children) {
          appendNavLink(group, {
            path: child.path,
            label: child.label,
            currentPath,
            allPaths,
            indent: true,
          });
        }
        sub.appendChild(group);
      } else {
        appendNavLink(sub, {
          path: item.path,
          label: item.label,
          currentPath,
          allPaths,
        });
      }
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
