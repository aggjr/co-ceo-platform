import { Show, createSignal } from 'solid-js';
import { ApiError, apiRequest } from '../../api/client.js';
import { getActiveContext } from '../../auth/session.js';

type SyncStatus = 'idle' | 'loading';

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
    if (!ctx) return '';
    if (ctx.scope === 'global') {
      return 'Sincroniza cotações de todas as ações/FIIs em uso (brapi).';
    }
    if (ctx.organizationId) {
      return 'Atualiza cotações das ações/FIIs desta organização.';
    }
    return 'Personifique a holding para sincronizar cotações.';
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
        class="btn-header-quotes"
        disabled={!canSync() || status() === 'loading'}
        title={hint()}
        aria-busy={status() === 'loading'}
        onClick={() => void runSync()}
      >
        {status() === 'loading' ? 'Atualizando…' : 'Cotações do dia'}
      </button>
      <Show when={flash()}>
        <span class="header-quotes-sync__flash" role="status">
          {flash()}
        </span>
      </Show>
    </div>
  );
}
