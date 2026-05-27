/**
 * TEMPORÁRIO — Limpa histórico financeiro/patrimonial:
 * remove pernas zeradas, proventos órfãos, repara links bidirecionais e elimina duplicatas.
 * Visível só em escopo global (equipe co-CEO).
 */
import { Show, createSignal } from 'solid-js';
import { ApiError, apiRequest } from '../../api/client.js';
import { activeContext } from '../../shell/shellState';

type CleanupStatus = 'idle' | 'loading';

interface CouplingFixSummary {
  dryRun: boolean;
  executedAt: string;
  step1_zeroAmountFinancialLegs: number;
  step2_orphanIncomeInKindPatrimony: number;
  step3_repairedBidirectionalLinks: number;
  step4_financialDuplicatesRemoved: number;
  step4_patrimonyDuplicatesRemoved: number;
}

function formatSummary(s: CouplingFixSummary): string {
  const total =
    s.step1_zeroAmountFinancialLegs +
    s.step2_orphanIncomeInKindPatrimony +
    s.step4_financialDuplicatesRemoved +
    s.step4_patrimonyDuplicatesRemoved;
  if (total === 0 && s.step3_repairedBidirectionalLinks === 0) {
    return 'Histórico limpo — nenhuma anomalia encontrada.';
  }
  const parts: string[] = [];
  if (s.step1_zeroAmountFinancialLegs > 0)
    parts.push(`${s.step1_zeroAmountFinancialLegs} perna(s) fin. zerada(s) removida(s)`);
  if (s.step2_orphanIncomeInKindPatrimony > 0)
    parts.push(`${s.step2_orphanIncomeInKindPatrimony} provento(s) patrimonial(is) órfão(s) removido(s)`);
  if (s.step3_repairedBidirectionalLinks > 0)
    parts.push(`${s.step3_repairedBidirectionalLinks} link(s) bidirecional(is) reparado(s)`);
  if (s.step4_financialDuplicatesRemoved + s.step4_patrimonyDuplicatesRemoved > 0)
    parts.push(
      `${s.step4_financialDuplicatesRemoved + s.step4_patrimonyDuplicatesRemoved} duplicata(s) removida(s)`
    );
  return parts.join(' | ');
}

export function UiCatalogApplyButton() {
  const [status, setStatus] = createSignal<CleanupStatus>('idle');
  const [flash, setFlash] = createSignal<string | null>(null);

  const visible = () => activeContext()?.scope === 'global';

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const showFlash = (message: string) => {
    setFlash(message);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setFlash(null), 15000);
  };

  const runCleanup = async () => {
    if (status() === 'loading') return;
    setStatus('loading');
    try {
      const data = await apiRequest('/api/platform/invest/audit-fix-coupling', {
        method: 'POST',
        body: { dryRun: false },
      });
      const summary = data.summary as CouplingFixSummary;
      showFlash(formatSummary(summary));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha na limpeza de acoplamento.';
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
          id="btn-audit-fix-coupling"
          class="btn-header-quotes btn-header-quotes--temp"
          classList={{ 'btn-header-quotes--loading': status() === 'loading' }}
          disabled={status() === 'loading'}
          title="Limpar histórico: remove pernas zeradas, proventos órfãos, duplicatas e repara links bidirecionais."
          aria-label="Limpar histórico de acoplamento"
          aria-busy={status() === 'loading'}
          onClick={() => void runCleanup()}
        >
          {status() === 'loading' ? '…' : 'Limpar histórico'}
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
