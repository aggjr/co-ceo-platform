import { setPageTitle, refreshSessionState } from '../shell/shellState.js';

/**
 * Ponte de Compatibilidade (Strangler Pattern)
 * 
 * Chamado pelas páginas legadas escritas em Vanilla JS.
 * Em vez de destruir e reconstruir a barra lateral (Sidebar) e o cabeçalho (Header) a cada rota,
 * este adaptador apenas atualiza o sinal reativo de título do SolidJS e renderiza o HTML
 * interno da página no container central.
 */
/**
 * @param {{ title?: string, contentHtml?: string, content?: HTMLElement }} opts
 */
export async function renderShell(container, { title, contentHtml, content }) {
  setPageTitle(title ?? '');
  if (content instanceof HTMLElement) {
    container.replaceChildren(content);
  } else {
    container.innerHTML = contentHtml ?? '';
  }
  refreshSessionState();
}
