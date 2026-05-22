import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { resolveClientLandingPath } from '../auth/clientLanding.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';

export async function CockpitWelcomePage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  if (!isGlobalSession()) {
    navigate(await resolveClientLandingPath());
    return;
  }

  const content = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%;">
      <div class="card" style="text-align:center;padding:48px 32px">
        <h2 style="font-size:26px;color:var(--color-accent);margin-bottom:12px">Bem-vindo ao CO-CEO</h2>
        <p class="muted" style="max-width:520px;margin:0 auto;line-height:1.6">
          Plataforma de apoio à tomada de decisão. Use o menu à esquerda para acessar Cockpit, INVEST e demais módulos.
        </p>
      </div>
    </div>
  `;

  await renderShell(container, {
    title: 'CO-CEO',
    contentHtml: content,
  });
}
