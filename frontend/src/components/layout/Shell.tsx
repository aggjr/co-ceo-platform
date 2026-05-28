import { JSX, Show, createSignal, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { APP_VERSION } from '../../generated/version.js';
import { fetchAppVersion } from '../../lib/appVersion.js';
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
import { PlatformJobAlertsBanner } from './PlatformJobAlertsBanner';
import { MarketQuotesSyncButton } from './MarketQuotesSyncButton';
import { RemoteMigrationButton } from './RemoteMigrationButton';
import '../../styles/app.css';
import '../../styles/cockpit-shell.css';

export function Shell(props: { children?: JSX.Element }) {
  const navigate = useNavigate();
  const [appVersion, setAppVersion] = createSignal(APP_VERSION);

  onMount(() => {
    refreshSessionState();
    void fetchAppVersion().then(setAppVersion);
  });

  const handleLogout = () => {
    clearSession();
    refreshSessionState();
    navigate('/login');
  };

  const initial = () => {
    const u = user();
    return (u?.fullName || u?.email || '?').charAt(0).toUpperCase();
  };

  const userTooltip = () => {
    const u = user();
    if (!u) return 'Usuário';
    const name = u.fullName?.trim();
    const email = u.email?.trim();
    if (name && email) return `${name} (${email})`;
    return name || email || 'Usuário';
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
          <div
            data-app-version
            style={{ width: "100%", "margin-bottom": "12px", "font-size": "11px", color: "var(--color-accent)", opacity: 0.7, "text-align": "center", "font-weight": 500, "letter-spacing": "1px" }}
          >
            {appVersion()}
          </div>
          <button type="button" class="btn-logout" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      {/* Painel Principal (Main) */}
      <main class="main">
        {/* Se estiver emulando, envolve o frame em uma moldura dourada */}
        <div class={impersonating() ? 'impersonation-frame' : ''} style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
          
          {/* Cabeçalho */}
          <header class="header">

            {/* Bloco Esquerdo: Identidade */}
            <div class="header-left">
              <div class="header-title">
                <Show when={originalLines()} fallback="CO-CEO">
                  {(lines) => lines().line1}
                </Show>
              </div>
              <div class="header-subtitle">
                <Show when={originalLines()} fallback={roleHint()}>
                  {(lines) => lines().line2}
                </Show>
              </div>
            </div>

            {/* Bloco Central: Personificação */}
            <div class="header-center">
              <ImpersonationBar />
            </div>

            {/* Bloco Direito: sync cotações, usuário logado */}
            <div class="header-right">
              <RemoteMigrationButton />
              <MarketQuotesSyncButton />
              <div class="header-user">
                <div
                  class="avatar"
                  title={userTooltip()}
                  aria-label={userTooltip()}
                >
                  {initial()}
                </div>
                <span class="header-user-login" title={userTooltip()}>
                  {user()?.email || user()?.fullName || ''}
                </span>
              </div>
            </div>

          </header>

          {/* Conteúdo principal (painel IVA desativado — ver bloco comentado no git history / Shell.tsx) */}
          <div class="content shell-content">
            <div class="shell-content-alerts">
              <PlatformJobAlertsBanner />
            </div>
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
