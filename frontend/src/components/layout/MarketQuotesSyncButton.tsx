import { Show, createSignal } from 'solid-js';
import { ApiError, apiRequest } from '../../api/client.js';
import { getActiveContext } from '../../auth/session.js';

type SyncStatus = 'idle' | 'loading';

const QUOTES_TITLE =
  'Atualizar cotações diárias presentes no sistema (ações e FIIs via brapi).';

function RefreshIcon() {
  return (
    <svg
      class="header-sync-icon__svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
    </svg>
  );
}

/**
 * Atualiza cotações do dia (brapi → market_quotes_daily).
 * Plataforma: todos os tickers em uso; holding: ações/FIIs da organização.
 */
export function MarketQuotesSyncButton() {
  const [status, setStatus] = createSignal<SyncStatus>('idle');
  const [flash, setFlash] = createSignal<string | null>(null);

  const canSync = () => {
    const ctx = getActiveContext();
    if (!ctx) return false;
    if (ctx.scope === 'global') return true;
    return Boolean(ctx.organizationId);
  };

  const hint = () => {
    const ctx = getActiveContext();
    if (!ctx) return QUOTES_TITLE;
    if (ctx.scope === 'global') {
      return `${QUOTES_TITLE} Escopo: todas as organizações.`;
    }
    if (ctx.organizationId) {
      return `${QUOTES_TITLE} Escopo: organização personificada.`;
    }
    return `${QUOTES_TITLE} Personifique a holding para sincronizar.`;
  };

  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const showFlash = (message: string) => {
    setFlash(message);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setFlash(null), 8000);
  };

  const runSync = async () => {
    if (status() === 'loading' || !canSync()) return;
    const ctx = getActiveContext();
    setStatus('loading');
    try {
      if (ctx?.scope === 'global') {
        const data = await apiRequest('/api/invest/market/sync-stocks', {
          method: 'POST',
          body: {},
        });
        const saved = Number(data.saved ?? 0);
        const missing = Array.isArray(data.missing) ? data.missing.length : 0;
        const extra = missing > 0 ? ` (${missing} sem cotação na brapi)` : '';
        showFlash(`${saved} cotação(ões) gravada(s)${extra}.`);
      } else {
        const path = window.location.pathname;

        try {
          await apiRequest('/api/invest/quotes/sync-b3', {
            method: 'POST',
            body: {},
          });
        } catch (err: any) {
          console.error('Failed to sync b3 quotes', err);
        }

        if (path.includes('/invest/portfolio')) {
          const data = await apiRequest('/api/invest/admin/recalc-positions', {
            method: 'POST',
            body: {},
          });
          const updated = Number(data.updated ?? 0);
          showFlash(`Preços sincronizados. ${updated} posições recalculadas.`);
        } else if (path.includes('/invest/panorama') || path.includes('/invest/historico')) {
          const data = await apiRequest('/api/invest/admin/recalc-curve', {
            method: 'POST',
            body: {},
          });
          const processed = Number(data.processed ?? 0);
          showFlash(`Preços sincronizados. Curva recalculada: ${processed} dias processados.`);
        } else {
          showFlash(`Preços sincronizados com sucesso.`);
        }
      }
      window.dispatchEvent(new CustomEvent('coceo:route-refresh'));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao atualizar dados.';
      showFlash(msg);
    } finally {
      setStatus('idle');
    }
  };

  return (
    <div class="header-quotes-sync">
      <button
        type="button"
        class="btn-header-icon-sync"
        classList={{ 'btn-header-icon-sync--loading': status() === 'loading' }}
        disabled={!canSync() || status() === 'loading'}
        title={hint()}
        aria-label={hint()}
        aria-busy={status() === 'loading'}
        onClick={() => void runSync()}
      >
        <RefreshIcon />
      </button>
      <Show when={flash()}>
        <span class="header-quotes-sync__flash" role="status">
          {flash()}
        </span>
      </Show>
    </div>
  );
}
