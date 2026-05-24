import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { fetchAccessMatrix, hasCockpitClientScreens, resolveClientLandingPath } from '../auth/clientLanding.js';
import {
  getImpersonationToken,
  getToken,
  isAuthenticated,
  isImpersonating,
  setUser,
} from '../auth/session.js';
import { COCKPIT_EXCEL_THEME, mountCoCeoExcelGrid } from '../lib/coCeoExcelGrid.js';

function hasInvestAccess(matrix) {
  return (matrix?.resources || []).some(
    (r) => r.effect === 'allow' && r.key?.startsWith('screen.invest.')
  );
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const apiWithSession = (path) => apiRequest(path);

export async function ClientCockpitPage(container, currentPath) {
  const path = currentPath || window.location.pathname;
  const token = getImpersonationToken() || getToken();
  if (!token) {
    navigate('/login');
    return;
  }

  const accessMatrix = await fetchAccessMatrix();
  if (!hasCockpitClientScreens(accessMatrix)) {
    navigate(await resolveClientLandingPath());
    return;
  }

  let me;
  try {
    me = await apiWithSession('/api/cockpit/me');
    if (isImpersonating() && me?.user) {
      setUser({
        id: me.context?.userId,
        email: me.user.email,
        fullName: me.user.fullName,
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="error-banner">${err.message || 'Não foi possível carregar a sessão emulada.'}</div>`;
    return;
  }

  const [matrix, team, roles, storage] = await Promise.all([
    apiWithSession('/api/cockpit/me/access-matrix').catch(() => null),
    apiWithSession('/api/cockpit/me/team').catch(() => ({ team: [] })),
    apiWithSession('/api/cockpit/me/roles').catch(() => null),
    apiWithSession('/api/cockpit/me/storage').catch(() => null),
  ]);

  const storageUsed = storage?.storage?.bytesUsed ?? me?.storage?.bytesUsed ?? 0;
  const storageLimit = storage?.storage?.bytesLimit ?? me?.storage?.bytesLimit ?? null;
  const pct = storageLimit ? Math.min(100, (storageUsed / storageLimit) * 100) : 0;

  const screens = (matrix?.resources || []).filter((r) => r.type === 'screen' && r.effect === 'allow');
  const permissions = matrix?.permissions || [];

  const investCard = hasInvestAccess(matrix)
    ? `<div class="card" style="margin-bottom:20px">
        <h2 style="font-size:16px;margin-bottom:8px">INVEST — Patrimônio</h2>
        <p class="muted">Curva patrimonial diária de 2026, alinhada ao relatório BTG/Necton.</p>
        <p style="margin-top:16px">
          <a href="/invest" data-link class="btn-entrar" style="display:inline-block;text-decoration:none">Abrir patrimônio diário</a>
          <a href="/invest/portfolio" data-link class="btn-entrar" style="display:inline-block;text-decoration:none;margin-left:8px">Portfólio</a>
        </p>
      </div>`
    : '';

  const content = `
    ${investCard}
    <div class="grid-2">
      <div class="card">
        <h2 style="font-size:16px;margin-bottom:12px">Uso de dados</h2>
        <p class="muted">Armazenamento da sua organização</p>
        <p style="font-size:24px;font-weight:700;margin-top:8px">${formatBytes(storageUsed)}${
          storageLimit ? ` <span class="muted" style="font-size:14px">/ ${formatBytes(storageLimit)}</span>` : ''
        }</p>
        ${storageLimit ? `<div class="storage-bar"><div class="storage-bar-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="card">
        <h2 style="font-size:16px;margin-bottom:12px">Seu acesso</h2>
        <p class="muted">Contrato: ${me?.contractId || '—'}</p>
        <p class="muted" style="margin-top:6px">Permissões API: ${permissions.length}</p>
        <div class="chip-list">
          ${screens.map((s) => `<span class="chip">${s.label}</span>`).join('') || '<span class="muted">Carregando matriz…</span>'}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <h2 style="font-size:16px;margin-bottom:12px">Sua equipe</h2>
      <p class="muted" style="margin-bottom:12px">Gestão simples — convites e papéis em breve.</p>
      <div id="client-team-grid"></div>
    </div>
    ${
      roles?.modules
        ? `<div class="card" style="margin-top:20px">
      <h2 style="font-size:16px;margin-bottom:12px">Módulos contratados</h2>
      <div class="chip-list">${roles.modules.map((m) => `<span class="chip">${m.module_code}</span>`).join('')}</div>
    </div>`
        : ''
    }
  `;

  let pageTitle = 'Cockpit — Minha organização';
  if (path.endsWith('/team')) pageTitle = 'Cockpit — Equipe';
  else if (path.endsWith('/roles')) pageTitle = 'Cockpit — Papéis';
  else if (path.endsWith('/storage')) pageTitle = 'Cockpit — Armazenamento';

  await renderShell(container, {
    title: pageTitle,
    contentHtml: content,
  });

  const teamHost = container.querySelector('#client-team-grid');
  if (teamHost) {
    mountCoCeoExcelGrid(teamHost, {
      gridId: 'client-team-v1',
      tableTheme: COCKPIT_EXCEL_THEME,
      coCeoColumns: [
        {
          key: 'full_name',
          label: 'Nome',
          type: 'text',
          width: '180px',
          sticky: true,
          render: (row) => {
            const span = document.createElement('span');
            span.textContent = row.full_name || '—';
            return span;
          },
        },
        { key: 'email', label: 'E-mail', type: 'text', width: '220px' },
        { key: 'status', label: 'Status', type: 'text', width: '100px' },
        { key: 'roles', label: 'Papéis', type: 'text', width: '160px' },
      ],
      rows: (team?.team || []).map((m, i) => ({
        id: String(m.id ?? m.email ?? i),
        ...m,
      })),
      emptyText: 'Nenhum membro na equipe.',
    });
  }
}
