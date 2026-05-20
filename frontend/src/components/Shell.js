import { setPageTitle, refreshSessionState } from '../shell/shellState.js';

/**
 * Ponte de Compatibilidade (Strangler Pattern)
 * 
 * Chamado pelas páginas legadas escritas em Vanilla JS.
 * Em vez de destruir e reconstruir a barra lateral (Sidebar) e o cabeçalho (Header) a cada rota,
 * este adaptador apenas atualiza o sinal reativo de título do SolidJS e renderiza o HTML
 * interno da página no container central.
 */
export async function renderShell(container, { title, contentHtml }) {
  setPageTitle(title);
  container.innerHTML = contentHtml;
  refreshSessionState();
}
