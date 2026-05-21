import { apiRequest } from '../api/client.js';
import { buildImpersonationLines } from '../auth/impersonationLabel.js';
import {
  getActiveContext,
  getUser,
  isGlobalSession,
  isImpersonating,
  openImpersonationTab,
} from '../auth/session.js';
import { trackButtonClick } from '../telemetry/index.js';

function pathDepth(path) {
  return String(path || '').split('/').filter(Boolean).length;
}

function orgIcon(type) {
  if (type === 'holding' || type === 'company') return '🏢';
  if (type === 'factory') return '🏭';
  if (type === 'store') return '🏪';
  return '▪';
}

function buildOrgOptions(nodes, selectEl) {
  if (!nodes.length) return;
  const minDepth = Math.min(...nodes.map((n) => pathDepth(n.path)));
  nodes.forEach((n) => {
    const depth = pathDepth(n.path) - minDepth;
    const indent = '\u00A0'.repeat(depth * 4);
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.dataset.contractId = n.contract_id || '';
    opt.textContent = `${indent}${depth > 0 ? '↳ ' : ''}${orgIcon(n.type)} ${n.name}`;
    selectEl.appendChild(opt);
  });
}

async function canUseClientImpersonation() {
  try {
    const matrix = await apiRequest('/api/cockpit/me/access-matrix');
    return (matrix.permissions || []).includes('cockpit:impersonate:execute');
  } catch {
    return false;
  }
}

function fillImpersonationBadge(note, lines) {
  note.replaceChildren();
  const l1 = document.createElement('span');
  l1.className = 'impersonate-line';
  l1.textContent = lines.line1;
  const l2 = document.createElement('span');
  l2.className = 'impersonate-line';
  l2.textContent = lines.line2;
  note.append(l1, l2);
}

async function renderImpersonationActiveNote(container) {
  const bar = document.createElement('div');
  bar.className = 'topbar-impersonate topbar-impersonate--active';
  const note = document.createElement('span');
  note.className = 'badge-impersonation badge-impersonation--stacked';
  fillImpersonationBadge(note, {
    line1: 'Usuário emulado: …',
    line2: 'Unidade: …',
  });
  bar.append(note);
  container.replaceChildren(bar);

  try {
    const me = await apiRequest('/api/cockpit/me');
    fillImpersonationBadge(note, buildImpersonationLines(me));
  } catch {
    fillImpersonationBadge(note, {
      line1: 'Usuário emulado',
      line2: 'Unidade de negócio',
    });
  }
}

async function buildImpersonatorMeta() {
  const user = getUser();
  const ctx = getActiveContext();
  const global = isGlobalSession();
  let organizationName = global ? 'Plataforma co-CEO' : null;
  if (!global) {
    try {
      const me = await apiRequest('/api/cockpit/me');
      organizationName = me?.organizationName ?? organizationName;
    } catch {
      /* ignora */
    }
  }
  return {
    userId: ctx?.userId,
    email: user?.email,
    fullName: user?.fullName,
    organizationName,
    scope: ctx?.scope,
  };
}

function setUserSelectPlaceholder(userSelect, text, disabled = true) {
  userSelect.replaceChildren();
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = text;
  userSelect.appendChild(opt);
  userSelect.disabled = disabled;
}

export async function mountImpersonationBar(container) {
  const global = isGlobalSession();
  const ctx = getActiveContext();

  if (isImpersonating()) {
    await renderImpersonationActiveNote(container);
    return;
  }

  if (!global) {
    const allowed = await canUseClientImpersonation();
    if (!allowed) {
      container.replaceChildren();
      return;
    }
  }

  let nodes = [];

  try {
    if (global) {
      const res = await apiRequest('/api/cockpit/platform/org-tree');
      nodes = res.nodes || [];
    } else {
      const res = await apiRequest('/api/cockpit/me/org-tree');
      nodes = res.nodes || [];
    }
  } catch {
    container.replaceChildren();
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'topbar-impersonate';

  const label = document.createElement('span');
  label.className = 'impersonate-label';
  label.textContent = global ? 'Personificar:' : 'Simular usuário:';

  const ouSelect = document.createElement('select');
  ouSelect.className = 'impersonate-combo';
  ouSelect.id = 'impersonate-ou';
  const ouDefault = document.createElement('option');
  ouDefault.value = '';
  ouDefault.textContent = global
    ? 'Visão global — sem personificar'
    : 'Selecione a unidade da equipe...';
  ouSelect.appendChild(ouDefault);
  buildOrgOptions(nodes, ouSelect);

  const userSelect = document.createElement('select');
  userSelect.className = 'impersonate-combo';
  userSelect.id = 'impersonate-user';
  setUserSelectPlaceholder(userSelect, 'Selecione o colaborador...');

  const statusEl = document.createElement('span');
  statusEl.className = 'impersonate-status';
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.textContent = '';

  const enterBtn = document.createElement('button');
  enterBtn.type = 'button';
  enterBtn.className = 'btn-entrar';
  enterBtn.id = 'impersonate-enter';
  enterBtn.textContent = 'Simular acesso';
  enterBtn.disabled = true;
  enterBtn.title = global
    ? 'Abrir sessão emulada em nova aba'
    : 'Ver o sistema como este membro da sua estrutura (nova aba)';

  bar.append(label, ouSelect, userSelect, statusEl, enterBtn);
  container.replaceChildren(bar);

  const resetUsers = () => {
    setUserSelectPlaceholder(userSelect, 'Selecione o colaborador...');
    statusEl.textContent = '';
    enterBtn.disabled = true;
  };

  ouSelect.addEventListener('change', async () => {
    resetUsers();
    const orgId = ouSelect.value;
    if (!orgId) return;

    const contractId = ouSelect.selectedOptions[0]?.dataset.contractId;
    if (global && !contractId) return;

    setUserSelectPlaceholder(userSelect, 'Carregando...');
    statusEl.textContent = 'Buscando colaboradores...';

    try {
      const path = global
        ? `/api/cockpit/platform/impersonation-targets?contractId=${encodeURIComponent(contractId)}&organizationId=${encodeURIComponent(orgId)}`
        : `/api/cockpit/me/impersonation-targets?organizationId=${encodeURIComponent(orgId)}`;

      const res = await apiRequest(path);
      const targets = res.targets || [];
      userSelect.replaceChildren();
      if (!targets.length) {
        setUserSelectPlaceholder(userSelect, 'Nenhum colaborador nesta unidade');
        statusEl.textContent = '';
        return;
      }
      const first = document.createElement('option');
      first.value = '';
      first.textContent = 'Selecione o colaborador...';
      userSelect.appendChild(first);
      targets.forEach((t) => {
        const o = document.createElement('option');
        o.value = t.user_role_id;
        o.dataset.userId = t.user_id;
        o.textContent = `${t.full_name || t.email} — ${t.role_name}`;
        userSelect.appendChild(o);
      });
      userSelect.disabled = false;
      statusEl.textContent = `${targets.length} colaborador(es)`;
    } catch (err) {
      setUserSelectPlaceholder(userSelect, 'Erro ao carregar');
      statusEl.textContent = err.message || 'Falha na busca';
    }
  });

  userSelect.addEventListener('change', () => {
    enterBtn.disabled = !userSelect.value;
  });

  enterBtn.addEventListener('click', async () => {
    const userRoleId = userSelect.value;
    const targetUserId = userSelect.selectedOptions[0]?.dataset.userId;
    if (!userRoleId || !targetUserId) return;

    enterBtn.disabled = true;
    try {
      trackButtonClick('button.cockpit.impersonate.enter', {
        screen_path: window.location.pathname === '/' ? '/login' : window.location.pathname,
        module_code: 'CORE',
      });
      const res = await apiRequest('/api/auth/impersonate', {
        method: 'POST',
        body: { targetUserId, userRoleId },
      });
      const impersonatorMeta = await buildImpersonatorMeta();
      const redirectPath = window.location.pathname.startsWith('/invest')
        ? window.location.pathname
        : '/invest/portfolio';
      const openedNewTab = openImpersonationTab(res.token, impersonatorMeta, {
        redirectPath,
      });
      statusEl.textContent = openedNewTab
        ? 'Sessão emulada aberta em nova aba. Confira a aba do Portfólio INVEST.'
        : 'Pop-up bloqueado — abrindo simulação nesta aba…';
    } catch (err) {
      statusEl.textContent = err.message || err.body?.error || 'Falha na simulação';
    } finally {
      enterBtn.disabled = !userSelect.value;
    }
  });

}
