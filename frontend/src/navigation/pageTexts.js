import { loadUiManifest, resolveText } from './uiManifest.js';

/**
 * Retorna um dicionario { key => texto resolvido } para as chaves solicitadas.
 * Se o manifesto ja estiver em cache, a resolucao e sincrona dentro do await;
 * se nao estiver, dispara a chamada unica compartilhada com o menu.
 *
 * Uso nas paginas:
 *   const t = await getPageTexts(['screen.invest.portfolio.title', 'column.invest.historico_operacoes.date']);
 *   t['screen.invest.portfolio.title']   // -> texto resolvido ou fallback
 *
 * @param {string[]} keys
 * @param {Record<string,string>} [fallbacks]  textos usados quando a chave nao existe no catalogo
 * @returns {Promise<Record<string,string>>}
 */
export async function getPageTexts(keys, fallbacks = {}) {
  let manifest = null;
  try {
    manifest = await loadUiManifest();
  } catch {
    // manifesto indisponivel — usa fallback para todas as chaves
  }
  const out = {};
  for (const key of keys) {
    out[key] = resolveText(manifest, key) !== key
      ? resolveText(manifest, key)
      : (fallbacks[key] ?? key);
  }
  return out;
}
