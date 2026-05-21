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
          
          {/* Cabeçalho (Header) */}
          <header class="header">
            <div class="header-top">
              <div class="header-title">
                <h1>{pageTitle()}</h1>

                <Show
                  when={originalLines()}
                  fallback={
                    <>
                      <p class="muted" style="margin: 0;">
                        Logado como <strong>{roleHint()}</strong>
                      </p>
                      <p class="muted header-email" style="margin: 2px 0 0 0;">
                        {user()?.email || ''}
                      </p>
                    </>
                  }
                >
                  {(lines) => (
                    <>
                      <p class="muted header-original" style="margin: 2px 0 0 0;">
                        <strong>{lines().line1}</strong>
                      </p>
                      <p class="muted header-original" style="margin: 2px 0 0 0;">
                        {lines().line2}
                      </p>
                    </>
                  )}
                </Show>
              </div>

              <div class="header-right">
              {/* IVA (IA conselheira) — desativada; reativar quando houver backend/API.
              <button
                type="button"
                class="btn-ghost"
                ...
              >
                <span>IVA</span>
              </button>
              */}

              <span class="app-version">{APP_VERSION}</span>
              
              <div
                class="user-profile"
                classList={{ 'user-profile--compact': impersonating() }}
                title={user()?.fullName || user()?.email || ''}
              >
                <div class="avatar">{initial()}</div>
                <Show when={!impersonating()}>
                  <span>{user()?.email || ''}</span>
                </Show>
              </div>
              </div>
            </div>

            <div id="impersonation-bar-host" class="header-impersonate-row">
              <ImpersonationBar />
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
