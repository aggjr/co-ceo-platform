import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { COCKPIT_EXCEL_THEME, mountCoCeoExcelGrid } from '../lib/coCeoExcelGrid.js';

function formatBytes(bytes) {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function mountContractsGrid(host, contracts, onSelect) {
  mountCoCeoExcelGrid(host, {
    gridId: 'platform-contracts-v1',
    tableTheme: COCKPIT_EXCEL_THEME,
    coCeoColumns: [
      {
        key: 'organization_name',
        label: 'Organização',
        type: 'text',
        width: '220px',
        sticky: true,
      },
      { key: 'status', label: 'Status', type: 'text', width: '100px' },
      {
        key: 'storage_bytes_used',
        label: 'Storage',
        type: 'text',
        align: 'right',
        width: '110px',
        render: (row) => {
          const span = document.createElement('span');
          span.textContent = formatBytes(row.storage_bytes_used);
          return span;
        },
      },
    ],
    rows: contracts.map((c) => ({ id: String(c.id), ...c })),
    emptyText: 'Nenhum contrato cadastrado.',
    onRowClick: (row) => onSelect(row.id),
  });
}

function mountMembersGrid(host, members) {
  mountCoCeoExcelGrid(host, {
    gridId: 'platform-members-v1',
    tableTheme: COCKPIT_EXCEL_THEME,
    coCeoColumns: [
      {
        key: 'full_name',
        label: 'Nome',
        type: 'text',
        width: '200px',
        sticky: true,
        render: (row) => {
          const span = document.createElement('span');
          span.textContent = row.full_name || row.email || '—';
          return span;
        },
      },
      { key: 'email', label: 'E-mail', type: 'text', width: '220px' },
      { key: 'status', label: 'Status', type: 'text', width: '100px' },
    ],
    rows: (members || []).map((m, i) => ({
      id: String(m.id ?? m.email ?? i),
      ...m,
    })),
    emptyText: 'Sem membros neste contrato.',
  });
}

export async function PlatformCockpitPage(container) {
  console.log('[PlatformCockpitPage] init');
  if (!isAuthenticated() || !isGlobalSession()) {
    console.log('[PlatformCockpitPage] auth failed, redirecting to /login');
    navigate('/login');
    return;
  }

  let contracts = [];
  try {
    const contractsRes = await apiRequest('/api/cockpit/platform/contracts');
    contracts = contractsRes.contracts || [];
  } catch (err) {
    const msg =
      err?.status === 401
        ? 'Sessão expirada. Faça login novamente — os dados do cliente continuam no banco.'
        : err?.message || 'Não foi possível carregar os contratos.';
    await renderShell(container, {
      title: 'Cockpit — Plataforma',
      contentHtml: `<div class="error-banner">${msg}</div>`,
    });
    return;
  }

  let selectedId = contracts[0]?.id || null;
  let iamData = null;

  const loadIam = async (contractId) => {
    if (!contractId) {
      iamData = null;
      return;
    }
    console.log(`[PlatformCockpitPage] loading IAM for contract: ${contractId}`);
    iamData = await apiRequest(`/api/cockpit/platform/contracts/${contractId}/iam`);
    console.log('[PlatformCockpitPage] IAM loaded:', iamData);
  };

  if (selectedId) {
    await loadIam(selectedId);
  } else {
    console.log('[PlatformCockpitPage] no selected contract ID');
  }

  const render = async () => {
    console.log('[PlatformCockpitPage] render start');
    const contractOptions = contracts
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.organization_name} (${c.status})</option>`
      )
      .join('');

    const storagePct =
      iamData?.contract?.plan_storage_limit_bytes && iamData?.contract?.storage_bytes_used
        ? Math.min(
            100,
            (Number(iamData.contract.storage_bytes_used) /
              Number(iamData.contract.plan_storage_limit_bytes)) *
              100
          )
        : 0;

    const modulesChips = (iamData?.modules || [])
      .map((m) => `<span class="chip">${m.module_code} · ${m.status}</span>`)
      .join('');

    const iamBlockClean = iamData?.contract
      ? `<p class="muted">Organização raiz: <strong>${iamData.contract.organization_name}</strong></p>
            <p class="muted" style="margin-top:8px">Armazenamento: ${formatBytes(iamData.contract.storage_bytes_used)}${
              iamData.contract.plan_storage_limit_bytes
                ? ` / ${formatBytes(iamData.contract.plan_storage_limit_bytes)}`
                : ' (ilimitado)'
            }</p>
            <div class="storage-bar"><div class="storage-bar-fill" style="width:${storagePct}%"></div></div>
            <div class="chip-list">${modulesChips || '<span class="muted">Sem módulos</span>'}</div>`
      : '<p class="muted">Selecione um contrato.</p>';

    const contentHtml = `
      <div class="grid-2">
        <div class="card">
          <h2 style="font-size:16px;margin-bottom:12px">Contratos</h2>
          <div class="field">
            <label for="contract-select">Cliente</label>
            <select id="contract-select">${contractOptions || '<option>Nenhum contrato</option>'}</select>
          </div>
          <div id="platform-contracts-grid" style="margin-top:16px"></div>
        </div>
        <div class="card">
          <h2 style="font-size:16px;margin-bottom:12px">Visão IAM do contrato</h2>
          ${iamBlockClean}
        </div>
      </div>
      ${
        iamData
          ? `<div class="card" style="margin-top:20px">
        <h2 style="font-size:16px;margin-bottom:12px">Equipe do contrato (co-CEO vê tudo)</h2>
        <div id="platform-members-grid"></div>
      </div>`
          : ''
      }
    `;

    await renderShell(container, {
      title: 'Cockpit — Plataforma',
      contentHtml,
    });

    const contractsHost = container.querySelector('#platform-contracts-grid');
    if (contractsHost) {
      mountContractsGrid(contractsHost, contracts, async (id) => {
        selectedId = id;
        const select = container.querySelector('#contract-select');
        if (select) select.value = id;
        await loadIam(selectedId);
        await render();
      });
    }

    const membersHost = container.querySelector('#platform-members-grid');
    if (membersHost) {
      mountMembersGrid(membersHost, iamData?.members || []);
    }

    container.querySelector('#contract-select')?.addEventListener('change', async (e) => {
      selectedId = e.target.value;
      await loadIam(selectedId);
      await render();
    });
  };

  await render();
}
