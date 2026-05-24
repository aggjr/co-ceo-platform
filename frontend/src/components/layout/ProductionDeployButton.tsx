import { Show, createSignal } from 'solid-js';
import { ApiError, apiRequest } from '../../api/client.js';
import { getActiveContext } from '../../auth/session.js';

type DeployPhase = 'idle' | 'triggering' | 'waiting';

function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]! };
}

function versionGte(a: string, b: string): boolean {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return false;
  if (va.major !== vb.major) return va.major > vb.major;
  if (va.minor !== vb.minor) return va.minor > vb.minor;
  return va.patch >= vb.patch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Botão temporário: dispara webhook EasyPanel (servidor) e acompanha /api/version.
 * Visível só em escopo global (equipe co-CEO).
 */
export function ProductionDeployButton() {
  const [phase, setPhase] = createSignal<DeployPhase>('idle');
  const [flash, setFlash] = createSignal<string | null>(null);

  const canDeploy = () => getActiveContext()?.scope === 'global';

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const showFlash = (message: string) => {
    setFlash(message);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setFlash(null), 20000);
  };

  const pollUntilVersion = async (targetVersion: string, maxWaitMs = 12 * 60 * 1000) => {
    const start = Date.now();
    let last = '';
    while (Date.now() - start < maxWaitMs) {
      const data = await apiRequest('/api/version');
      last = String(data.version ?? '');
      showFlash(`Aguardando deploy… produção: ${last || '?'} (alvo ${targetVersion})`);
      if (last && versionGte(last, targetVersion)) return last;
      await sleep(15000);
    }
    throw new Error(
      `Timeout: produção ainda em ${last || '?'}. Confira o build no EasyPanel ou redeploy manual.`
    );
  };

  const runDeploy = async () => {
    if (!canDeploy() || phase() !== 'idle') return;
    setPhase('triggering');
    try {
      const status = await apiRequest('/api/platform/deploy/status');
      if (!status.webhookConfigured) {
        showFlash(status.note || 'Configure EASYPANEL_DEPLOY_WEBHOOK_URL no EasyPanel.');
        return;
      }

      const result = await apiRequest('/api/platform/deploy/production', {
        method: 'POST',
        body: {},
      });
      const target = String(result.targetVersion ?? result.runningVersion ?? '');
      setPhase('waiting');
      const deployed = await pollUntilVersion(target);
      showFlash(`Produção em ${deployed}. Recarregue com Ctrl+F5.`);
      window.dispatchEvent(new CustomEvent('coceo:route-refresh'));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.body?.error || err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao publicar.';
      showFlash(msg);
    } finally {
      setPhase('idle');
    }
  };

  return (
    <Show when={canDeploy()}>
      <div class="header-quotes-sync header-deploy-sync">
        <button
          type="button"
          class="btn-header-quotes btn-header-deploy-temp"
          disabled={phase() !== 'idle'}
          title="Dispara redeploy no EasyPanel (webhook no servidor). Temporário — equipe co-CEO."
          aria-busy={phase() !== 'idle'}
          onClick={() => void runDeploy()}
        >
          {phase() === 'triggering'
            ? 'Publicando…'
            : phase() === 'waiting'
              ? 'Aguardando…'
              : 'Publicar produção'}
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
