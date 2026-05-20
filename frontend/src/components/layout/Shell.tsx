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
  aiPanelOpen,
  setAiPanelOpen,
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

            {/* Barra de Impersonação / Emulação */}
            <div id="impersonation-bar-host">
              <ImpersonationBar />
            </div>

            {/* Lado Direito do Cabeçalho */}
            <div class="header-right">
              {/* Botão Sparlke para a IVA (IA Consultora) */}
              <button
                type="button"
                class="btn-ghost"
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '6px',
                  border: aiPanelOpen() ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                  color: aiPanelOpen() ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  background: aiPanelOpen() ? 'rgba(218, 177, 119, 0.08)' : 'transparent',
                }}
                onClick={() => setAiPanelOpen(!aiPanelOpen())}
                title="Conversar com a IVA (IA Consultora)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                <span>IVA</span>
              </button>

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
          </header>

          {/* Área de Conteúdo Central + Painel da IA */}
          <div style="display: flex; flex: 1; min-height: 0; position: relative; overflow: hidden;">
            
            {/* Conteúdo Principal */}
            <div class="content" style="flex: 1; overflow-y: auto;">
              {props.children}
            </div>

            {/* Painel Lateral da IA Consultora (IVA) */}
            <div
              style={{
                width: '320px',
                background: 'var(--color-surface)',
                'border-left': '1px solid var(--color-border)',
                display: aiPanelOpen() ? 'flex' : 'none',
                'flex-direction': 'column',
                'min-height': '100%',
                position: 'relative',
                'box-shadow': '-5px 0 25px rgba(0,0,0,0.3)',
                transition: 'all 0.3s ease',
              }}
            >
              <div
                style={{
                  padding: '16px',
                  'border-bottom': '1px solid var(--color-border)',
                  display: 'flex',
                  'justify-content': 'space-between',
                  'align-items': 'center',
                }}
              >
                <h3 style={{ 'font-size': '15px', color: 'var(--color-accent)', margin: 0 }}>
                  IVA · Assistente Virtual
                </h3>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setAiPanelOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  padding: '16px',
                  overflow: 'auto',
                  display: 'flex',
                  'flex-direction': 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    padding: '12px',
                    'border-radius': '8px',
                    'font-size': '12.5px',
                    'border-left': '3px solid var(--color-accent)',
                  }}
                >
                  Olá! Sou a **IVA**, sua IA conselheira estratégica. Como posso ajudar com a gestão de gargalos da sua organização ou análise de carteira hoje?
                </div>
              </div>
              <div
                style={{
                  padding: '12px',
                  'border-top': '1px solid var(--color-border)',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <input
                  type="text"
                  placeholder="Escreva sua dúvida..."
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--color-border)',
                    'border-radius': '6px',
                    color: '#fff',
                    'font-size': '12.5px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn-primary"
                  style={{ padding: '6px 12px', 'font-size': '12.5px', 'border-radius': '6px' }}
                >
                  Enviar
                </button>
              </div>
            </div>

          </div>

        </div>
      </main>
    </div>
  );
}
