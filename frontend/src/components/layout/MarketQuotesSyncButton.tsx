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
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
      />
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
        const data = await apiRequest('/api/invest/quotes/sync-b3', {
          method: 'POST',
          body: {},
        });
        const updated = Number(data.updated ?? 0);
        const missing = Array.isArray(data.missing) ? data.missing.length : 0;
        const extra = missing > 0 ? ` — ${missing} sem resposta` : '';
        showFlash(`${updated} ativo(s) atualizado(s)${extra}.`);
      }
      window.dispatchEvent(new CustomEvent('coceo:route-refresh'));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao atualizar cotações.';
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
