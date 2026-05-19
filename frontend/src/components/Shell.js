import '../styles/app.css';
import '../styles/cockpit-shell.css';
import { APP_VERSION } from '../generated/version.js';
import { formatOriginalSessionLines } from '../auth/impersonationLabel.js';
import {
  clearSession,
  getActiveContext,
  getImpersonatorMeta,
  getUser,
  isImpersonating,
} from '../auth/session.js';
import { navigate } from '../router.js';
import { mountImpersonationBar } from './ImpersonationBar.js';
import { mountSideNav } from './SideNav.js';
import { loadVisibleMenu } from '../navigation/buildVisibleMenu.js';

export async function renderShell(container, { title, contentHtml }) {
  const user = getUser();
  const ctx = getActiveContext();
  const impersonating = isImpersonating();
  const impMeta = impersonating ? getImpersonatorMeta() : null;
  const originalLines = impersonating ? formatOriginalSessionLines(impMeta) : null;

  const initial = (user?.email || user?.fullName || '?').charAt(0).toUpperCase();
  const currentPath = window.location.pathname === '/' ? '/login' : window.location.pathname;
  const roleHint = ctx?.scope === 'global' ? 'Equipe co-CEO' : 'Administrador do cliente';

  const headerIdentity = originalLines
    ? [
        `<p class="muted header-original">${originalLines.line1}</p>`,
        `<p class="muted header-original">${originalLines.line2}</p>`,
      ].join('')
    : [
        `<p class="muted">Logado como <strong>${roleHint}</strong></p>`,
        `<p class="muted header-email">${user?.email || ''}</p>`,
      ].join('');

  const profileHtml = impersonating
    ? `<div class="user-profile user-profile--compact" title="${user?.fullName || user?.email || ''}"><div class="avatar">${initial}</div></div>`
    : `<div class="user-profile"><div class="avatar">${initial}</div><span>${user?.email || ''}</span></div>`;

  const shellClass = impersonating ? 'shell shell--impersonating' : 'shell';
  const frameOpen = impersonating ? '<div class="impersonation-frame">' : '';
  const frameClose = impersonating ? '</div>' : '';

  container.innerHTML = [
    `<div class="${shellClass}">`,
    '<aside class="sidebar">',
    '<div class="brand">CO<span>-</span>CEO</div>',
    '<nav id="app-side-nav" class="side-nav" aria-label="Módulos"></nav>',
    '<div class="sidebar-footer">',
    '<button type="button" class="btn-logout" id="btn-logout">Sair</button>',
    '</div></aside>',
    '<main class="main">',
    frameOpen,
    '<header class="header">',
    '<div class="header-title">',
    '<h1>', title, '</h1>',
    headerIdentity,
    '</div>',
    '<div id="impersonation-bar-host"></div>',
    '<div class="header-right">',
    '<span class="app-version">', APP_VERSION, '</span>',
    profileHtml,
    '</div></header>',
    '<div class="content">', contentHtml, '</div>',
    frameClose,
    '</main></div>',
  ].join('');

  const menu = await loadVisibleMenu();
  const navHost = container.querySelector('#app-side-nav');
  if (navHost) {
    mountSideNav(navHost, menu, currentPath);
  }

  container.querySelector('#btn-logout')?.addEventListener('click', () => {
    clearSession();
    navigate('/login');
  });

  const impHost = container.querySelector('#impersonation-bar-host');
  if (impHost) {
    await mountImpersonationBar(impHost);
  }
}
