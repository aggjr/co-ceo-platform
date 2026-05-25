/**
 * TEMPORÁRIO — remover quando o DE-PARA for aplicado automaticamente no deploy.
 * Sessão plataforma (escopo global): POST /api/platform/ui-catalog/apply
 */
import { Show, createSignal, onMount } from 'solid-js';
import { ApiError, apiRequest } from '../../api/client.js';
import { clearUiManifestCache } from '../../navigation/uiManifest.js';
import { getPageTexts } from '../../navigation/pageTexts.js';
import { activeContext } from '../../shell/shellState';

type ApplyStatus = 'idle' | 'loading';

const TEXT_KEYS = [
  'action.platform.ui_catalog_apply',
  'action.platform.ui_catalog_apply.hint',
  'action.platform.ui_catalog_apply.done',
] as const;

export function UiCatalogApplyButton() {
  const [status, setStatus] = createSignal<ApplyStatus>('idle');
  const [flash, setFlash] = createSignal<string | null>(null);
  const [label, setLabel] = createSignal<string>(TEXT_KEYS[0]);
  const [hint, setHint] = createSignal('');

  onMount(async () => {
    const t = await getPageTexts([...TEXT_KEYS]);
    if (t['action.platform.ui_catalog_apply'] !== 'action.platform.ui_catalog_apply') {
      setLabel(t['action.platform.ui_catalog_apply']);
    }
    if (t['action.platform.ui_catalog_apply.hint'] !== 'action.platform.ui_catalog_apply.hint') {
      setHint(t['action.platform.ui_catalog_apply.hint']);
    }
  });

  const visible = () => activeContext()?.scope === 'global';

  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const showFlash = (message: string) => {
    setFlash(message);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setFlash(null), 12000);
  };

  const runApply = async () => {
    if (status() === 'loading') return;
    setStatus('loading');
    try {
      const data = await apiRequest('/api/platform/ui-catalog/apply', {
        method: 'POST',
        body: {},
      });
      clearUiManifestCache();
      const t = await getPageTexts([...TEXT_KEYS]);
      const template = t['action.platform.ui_catalog_apply.done'];
      const texts = Number(data.textsUpserted ?? 0);
      const menu = Number(data.menuUpserted ?? 0);
      const msg =
        template !== 'action.platform.ui_catalog_apply.done'
          ? template.replace('{texts}', String(texts)).replace('{menu}', String(menu))
          : `Catálogo sincronizado (${texts} textos, ${menu} menu).`;
      showFlash(msg);
      window.dispatchEvent(new CustomEvent('coceo:route-refresh'));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao sincronizar catálogo UI.';
      showFlash(msg);
    } finally {
      setStatus('idle');
    }
  };

  return (
    <Show when={visible()}>
      <div class="header-ui-catalog-apply">
        <button
          type="button"
          class="btn-header-quotes btn-header-quotes--temp"
          classList={{ 'btn-header-quotes--loading': status() === 'loading' }}
          disabled={status() === 'loading'}
          title={hint() || label()}
          aria-label={label()}
          aria-busy={status() === 'loading'}
          onClick={() => void runApply()}
        >
          {status() === 'loading' ? '…' : label()}
        </button>
        <Show when={flash()}>
          <span class="header-quotes-sync__flash" role="status">
            {flash()}
          </span>
        </Show>
      </div>
    </Show>
  );
}
