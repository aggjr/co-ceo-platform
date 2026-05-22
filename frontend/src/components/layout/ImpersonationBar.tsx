import { createSignal, onMount, For, Show } from 'solid-js';
import { apiRequest } from '../../api/client.js';
import { buildImpersonationLines } from '../../auth/impersonationLabel.js';
import {
  getActiveContext,
  getUser,
  isGlobalSession,
  isImpersonating,
  openImpersonationTab,
} from '../../auth/session.js';
import { trackButtonClick } from '../../telemetry/index.js';

interface OrgNode {
  id: string;
  parent_id?: string | null;
  name: string;
  type: string;
  path: string;
  contract_id?: string;
}

interface TargetUser {
  user_role_id: string;
  user_id: string;
  full_name?: string;
  email: string;
  role_name: string;
}

export function ImpersonationBar() {
  const global = isGlobalSession();
  const impersonating = isImpersonating();

  // Estados reativos
  const [allowed, setAllowed] = createSignal(false);
  const [nodes, setNodes] = createSignal<OrgNode[]>([]);
  const [selectedOrgId, setSelectedOrgId] = createSignal<string>('');
  const [selectedUserRoleId, setSelectedUserRoleId] = createSignal<string>('');
  const [targets, setTargets] = createSignal<TargetUser[]>([]);
  const [loadingUsers, setLoadingUsers] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [statusText, setStatusText] = createSignal('');
  
  // Estado para quando a impersonação está ativa
  const [activeLines, setActiveLines] = createSignal({
    line1: 'Usuário emulado: ...',
    line2: 'Unidade: ...',
  });

  const pathDepth = (path: string) => {
    return String(path || '').split('/').filter(Boolean).length;
  };

  const orgIcon = (type: string) => {
    if (type === 'holding' || type === 'company') return '🏢';
    if (type === 'factory') return '🏭';
    if (type === 'store') return '🏪';
    return '▪';
  };

  const checkPermissionAndLoadTree = async () => {
    if (impersonating) {
      try {
        const me = await apiRequest('/api/cockpit/me');
        setActiveLines(buildImpersonationLines(me));
      } catch {
        setActiveLines({
          line1: 'Usuário emulado',
          line2: 'Unidade de negócio',
        });
      }
      return;
    }

    let isAllowed = false;
    if (global) {
      isAllowed = true;
    } else {
      try {
        const matrix = await apiRequest('/api/cockpit/me/access-matrix');
        isAllowed = (matrix.permissions || []).includes('cockpit:impersonate:execute');
      } catch {
        isAllowed = false;
      }
    }

    setAllowed(isAllowed);

    if (!isAllowed) return;

    try {
      const path = global ? '/api/cockpit/platform/org-tree' : '/api/cockpit/me/org-tree';
      const res = await apiRequest(path);
      setNodes(res.nodes || []);
    } catch (err) {
      console.error('Erro ao buscar árvore de organizações:', err);
    }
  };

  onMount(() => {
    void checkPermissionAndLoadTree();
  });

  // Carregar os colaboradores quando mudar a unidade organizacional
  const handleOrgChange = async (orgId: string) => {
    setSelectedOrgId(orgId);
    setSelectedUserRoleId('');
    setTargets([]);
    setStatusText('');

    if (!orgId) return;

    const selectedNode = nodes().find((n) => n.id === orgId);
    const contractId = selectedNode?.contract_id;
    if (global && !contractId) return;

    setLoadingUsers(true);
    setStatusText('Buscando colaboradores...');

    try {
      const path = global
        ? `/api/cockpit/platform/impersonation-targets?contractId=${encodeURIComponent(contractId || '')}&organizationId=${encodeURIComponent(orgId)}`
        : `/api/cockpit/me/impersonation-targets?organizationId=${encodeURIComponent(orgId)}`;

      const res = await apiRequest(path);
      const list = res.targets || [];
      setTargets(list);
      setStatusText(list.length > 0 ? `${list.length} colaborador(es)` : 'Nenhum colaborador nesta unidade');
    } catch (err: any) {
      setStatusText(err.message || 'Falha na busca');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleEnterImpersonation = async () => {
    const roleId = selectedUserRoleId();
    if (!roleId) return;

    const selectedTarget = targets().find((t) => t.user_role_id === roleId);
    if (!selectedTarget) return;

    setSubmitting(true);
    try {
      trackButtonClick('button.cockpit.impersonate.enter', {
        screen_path: window.location.pathname === '/' ? '/login' : window.location.pathname,
        module_code: 'CORE',
      });

      const res = await apiRequest('/api/auth/impersonate', {
        method: 'POST',
        body: { targetUserId: selectedTarget.user_id, userRoleId: roleId },
      });

      // Constroi os metadados do personificador
      const user = getUser();
      const ctx = getActiveContext();
      let organizationName = global ? 'Plataforma co-CEO' : null;

      if (!global) {
        try {
          const me = await apiRequest('/api/cockpit/me');
          organizationName = me?.organizationName ?? organizationName;
        } catch {
          // ignora
        }
      }

      const impersonatorMeta = {
        userId: ctx?.userId,
        email: user?.email,
        fullName: user?.fullName,
        organizationName,
        scope: ctx?.scope,
      };

      const redirectPath = window.location.pathname.startsWith('/invest')
        ? window.location.pathname
        : '/invest/portfolio';

      const openedNewTab = openImpersonationTab(res.token, impersonatorMeta, {
        redirectPath,
      });

      setStatusText(
        openedNewTab
          ? 'Sessão emulada aberta em nova aba. Confira a aba do Portfólio INVEST.'
          : 'Pop-up bloqueado — abrindo simulação nesta aba…'
      );
    } catch (err: any) {
      const msg = err?.message || err?.body?.error || 'Falha na simulação';
      setStatusText(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const minDepth = () => Math.min(...nodes().map((n) => pathDepth(n.path)));

  return (
    <Show when={impersonating || allowed()}>
      <div
        class="topbar-impersonate"
        classList={{ 'topbar-impersonate--active': impersonating }}
      >
        <Show
          when={!impersonating}
          fallback={
            <span class="badge-impersonation badge-impersonation--stacked">
              <span class="impersonate-line">{activeLines().line1}</span>
              <span class="impersonate-line">{activeLines().line2}</span>
            </span>
          }
        >
          <div style="display: flex; gap: 12px; align-items: flex-end;">
            {/* Box 1 - Org */}
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span class="impersonate-label" style="text-align: left; padding: 0;">
                {global ? 'Personificar:' : 'Simular usuário:'}
              </span>
              <select
                class="impersonate-combo"
                id="impersonate-ou"
                value={selectedOrgId()}
                onChange={(e) => handleOrgChange(e.currentTarget.value)}
              >
                <option value="">
                  {global ? 'Visão global — sem personificar' : 'Selecione a unidade da equipe...'}
                </option>
                <For each={nodes()}>
                  {(n) => {
                    const depth = pathDepth(n.path) - minDepth();
                    const indent = '\u00A0'.repeat(depth * 4);
                    return (
                      <option value={n.id} data-contract-id={n.contract_id || ''}>
                        {indent}
                        {depth > 0 ? '↳ ' : ''}
                        {orgIcon(n.type)} {n.name}
                      </option>
                    );
                  }}
                </For>
              </select>
            </div>

            {/* Box 2 - User */}
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span class="impersonate-label" style="text-align: left; padding: 0;">
                Usuário:
              </span>
              <select
                class="impersonate-combo"
                id="impersonate-user"
                value={selectedUserRoleId()}
                disabled={loadingUsers() || targets().length === 0}
                onChange={(e) => setSelectedUserRoleId(e.currentTarget.value)}
              >
                <Show when={!loadingUsers()} fallback={<option value="">Carregando...</option>}>
                  <Show
                    when={targets().length > 0}
                    fallback={<option value="">Nenhum colaborador nesta unidade</option>}
                  >
                    <option value="">Selecione o colaborador...</option>
                    <For each={targets()}>
                      {(t) => (
                        <option value={t.user_role_id}>
                          {t.full_name || t.email} — {t.role_name}
                        </option>
                      )}
                    </For>
                  </Show>
                </Show>
              </select>
            </div>

            {/* Box 3 - Button */}
            <div>
              <button
                type="button"
                class="btn-entrar"
                id="impersonate-enter"
                disabled={!selectedUserRoleId() || submitting()}
                onClick={handleEnterImpersonation}
                title={
                  global
                    ? 'Abrir sessão emulada em nova aba'
                    : 'Ver o sistema como este membro da sua estrutura (nova aba)'
                }
              >
                {submitting() ? 'Entrando...' : (
                  <span style="display: inline-block; line-height: 1.2; text-align: center;">
                    Emular<br />Acesso
                  </span>
                )}
              </button>
            </div>
          </div>

          <Show when={statusText()}>
            <span class="impersonate-status" aria-live="polite">
              {statusText()}
            </span>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
