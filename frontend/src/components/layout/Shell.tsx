import { JSX, Show, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { APP_VERSION } from '../../generated/version.js';
import { formatOriginalSessionLines } from '../../auth/impersonationLabel.js';
import { clearSession } from '../../auth/session.js';
import {
  pageTitle,
  user,
  activeContext,
  impersonating,
  impersonatorMeta,
  refreshSessionState,
} from '../../shell/shellState';
import { SideNav } from './SideNav';
import { ImpersonationBar } from './ImpersonationBar';
import '../../styles/app.css';
import '../../styles/cockpit-shell.css';

export function Shell(props: { children?: JSX.Element }) {
  const navigate = useNavigate();

  onMount(() => {
    // Atualiza o estado dos sinais baseados no armazenamento local no montagem
    refreshSessionState();
  });

  const handleLogout = () => {
    clearSession();
    refreshSessionState();
    navigate('/login');
  };

  const initial = () => {
    const u = user();
    return (u?.email || u?.fullName || '?').charAt(0).toUpperCase();
  };

  const roleHint = () => {
    const ctx = activeContext();
    return ctx?.scope === 'global' ? 'Equipe co-CEO' : 'Administrador do cliente';
  };

  const originalLines = () => {
    const meta = impersonatorMeta();
    return meta ? formatOriginalSessionLines(meta) : null;
  };

  return (
    <div
      class="shell"
      classList={{ 'shell--impersonating': impersonating() }}
    >
      {/* Barra Lateral (Sidebar) */}
      <aside class="sidebar">
        <div class="brand">
          CO<span>-</span>CEO
        </div>
        
        {/* Componente SolidJS de navegação */}
        <SideNav />

        <div class="sidebar-footer">
          <button type="button" class="btn-logout" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      {/* Painel Principal (Main) */}
      <main class="main">
        {/* Se estiver emulando, envolve o frame em uma moldura dourada */}
        <div class={impersonating() ? 'impersonation-frame' : ''} style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
          
          {/* Cabeçalho — 2 linhas alinhadas */}
          <header class="header">

            {/* Coluna 1: identidade */}
            <div class="hdr-col">
              <span class="hdr-label">
                <Show when={originalLines()} fallback={roleHint()}>
                  {(lines) => lines().line1}
                </Show>
              </span>
              <span class="hdr-value">
                <Show when={originalLines()} fallback={user()?.email || ''}>
                  {(lines) => lines().line2}
                </Show>
              </span>
            </div>

            {/* Colunas 2-4: barra de personificação */}
            <ImpersonationBar />

            {/* Avatar */}
            <div
              class="avatar"
              title={user()?.fullName || user()?.email || ''}
              style="flex-shrink:0; margin-left: auto;"
            >
              {initial()}
            </div>

          </header>

          {/* Conteúdo principal (painel IVA desativado — ver bloco comentado no git history / Shell.tsx) */}
          <div class="content" style="flex: 1; min-height: 0; overflow-y: auto;">
            {props.children}
          </div>

          {/* IVA — painel lateral desativado até implementação.
          <div style={{ width: '320px', ... }}>...</div>
          */}

        </div>
      </main>
    </div>
  );
}
