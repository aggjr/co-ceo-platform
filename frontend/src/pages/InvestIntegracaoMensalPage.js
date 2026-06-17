import '../styles/invest-integracao-mensal.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import {
  pickPdfFilesFromFolder,
  pickExtractFilesFromFolder,
  pickHomeBrokerFilesFromFolder,
} from '../lib/importFilePicker.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthStatusBadge(status) {
  if (status === 'ready') return '<span class="monthly-badge monthly-badge--ok">Pronto</span>';
  if (status === 'already_imported') return '<span class="monthly-badge monthly-badge--idle">Já importado</span>';
  return '<span class="monthly-badge monthly-badge--err">Bloqueado</span>';
}

function renderBatchPreview(preview) {
  if (!preview?.months?.length) {
    return '<p class="muted">Selecione as pastas e valide o período.</p>';
  }
  const rows = preview.months.map((m) => `
    <tr>
      <td>${escapeHtml(m.month)}</td>
      <td>${monthStatusBadge(m.status)}</td>
      <td>${m.notesOk ? 'OK' : '—'}</td>
      <td>${m.financialOk ? 'OK' : '—'}</td>
      <td class="monthly-detail">${escapeHtml(m.resultDetail || m.financialDetail || '')}</td>
    </tr>
  `).join('');
  return `
    <p class="monthly-summary">${escapeHtml(preview.summary || '')}</p>
    <table class="monthly-preview-table">
      <thead>
        <tr><th>Mês</th><th>Status</th><th>Notas</th><th>Caixa</th><th>Detalhe</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function appendLog(logEl, message, type = '') {
  if (!logEl) return;
  const line = document.createElement('div');
  line.className = `monthly-log-line${type ? ` monthly-log-line--${type}` : ''}`;
  const time = new Date().toLocaleTimeString('pt-BR');
  line.textContent = `[${time}] ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function showConfirmDialog(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'monthly-confirm-overlay';
  overlay.innerHTML = `
    <div class="monthly-confirm-dialog">
      <h3>Atenção</h3>
      <p>${escapeHtml(message)}</p>
      <div class="monthly-actions">
        <button type="button" class="btn btn-secondary" id="batch-confirm-cancel">Cancelar</button>
        <button type="button" class="btn btn-primary monthly-apply" id="batch-confirm-ok">Confirmar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#batch-confirm-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#batch-confirm-ok')?.addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
}

export async function InvestIntegracaoMensalPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  if (isGlobalSession()) {
    await renderShell(container, {
      title: 'INVEST - Integração BTG',
      contentHtml: '<div class="card"><p class="muted">Personifique o titular da holding para executar a integração.</p></div>',
    });
    return;
  }

  const contentHtml = `
    <div class="monthly-import-page">
      <header class="monthly-header">
        <div>
          <p class="monthly-kicker">INVEST</p>
          <h1>Integração BTG em lote</h1>
          <p class="muted">
            Envie todas as notas, todos os extratos e os JSON de âncoras mensais do home broker.
            O sistema detecta os meses, evita duplicar lançamentos já gravados e processa tudo em ordem cronológica.
          </p>
        </div>
        <a href="/invest/conciliacao" data-link class="btn btn-ghost">Conciliação avançada</a>
      </header>

      <section class="monthly-panel">
        <div class="monthly-grid monthly-grid--3">
          <div class="monthly-file-card">
            <span class="monthly-field-title">Notas (pasta PDF)</span>
            <button id="batch-pick-notes" type="button" class="btn btn-file">Selecionar pasta</button>
            <small id="batch-notes-label">Nenhuma pasta selecionada</small>
          </div>
          <div class="monthly-file-card">
            <span class="monthly-field-title">Extratos (pasta PDF/CSV/TXT)</span>
            <button id="batch-pick-extracts" type="button" class="btn btn-file">Selecionar pasta</button>
            <small id="batch-extracts-label">Nenhuma pasta selecionada</small>
          </div>
          <div class="monthly-file-card">
            <span class="monthly-field-title">Âncoras home broker (JSON)</span>
            <button id="batch-pick-anchors" type="button" class="btn btn-file">Selecionar pasta</button>
            <small id="batch-anchors-label">Opcional — fechamentos mensais para opções antigas</small>
          </div>
        </div>

        <div class="monthly-reset-row">
          <label class="monthly-check">
            <input type="checkbox" id="batch-reset-first" />
            Limpar dados da holding antes de importar (preserva abertura)
          </label>
          <span class="muted">Desmarcado por padrão. Use só para remapear do zero.</span>
        </div>

        <div class="monthly-actions">
          <button id="batch-validate" type="button" class="btn btn-primary" disabled>Validar período</button>
          <button id="batch-apply" type="button" class="btn btn-primary monthly-apply" disabled>Importar tudo</button>
          <span id="batch-status" class="monthly-status">Aguardando arquivos.</span>
        </div>
      </section>

      <section class="monthly-panel">
        <div class="monthly-panel-heading">
          <div>
            <p class="monthly-kicker">Prévia</p>
            <h2>Batimento por mês</h2>
          </div>
          <span id="batch-ready-badge" class="monthly-badge">Pendente</span>
        </div>
        <div id="batch-preview">${renderBatchPreview(null)}</div>
      </section>

      <section class="monthly-panel">
        <div class="monthly-panel-heading">
          <p class="monthly-kicker">Log</p>
          <h2>Progresso da importação</h2>
        </div>
        <div id="batch-log" class="monthly-log"></div>
      </section>
    </div>
  `;

  await renderShell(container, { title: 'INVEST - Integração BTG', contentHtml });

  const btnPickNotes = container.querySelector('#batch-pick-notes');
  const btnPickExtracts = container.querySelector('#batch-pick-extracts');
  const btnPickAnchors = container.querySelector('#batch-pick-anchors');
  const btnValidate = container.querySelector('#batch-validate');
  const btnApply = container.querySelector('#batch-apply');
  const resetCheckbox = container.querySelector('#batch-reset-first');
  const notesLabel = container.querySelector('#batch-notes-label');
  const extractsLabel = container.querySelector('#batch-extracts-label');
  const anchorsLabel = container.querySelector('#batch-anchors-label');
  const statusEl = container.querySelector('#batch-status');
  const previewEl = container.querySelector('#batch-preview');
  const readyBadge = container.querySelector('#batch-ready-badge');
  const logEl = container.querySelector('#batch-log');

  let noteFiles = [];
  let extractFiles = [];
  let homeBrokerFiles = [];
  let lastPreview = null;
  let pollTimer = null;

  function setStatus(text, tone = '') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `monthly-status${tone ? ` monthly-status--${tone}` : ''}`;
  }

  function refreshButtons() {
    const readyForValidation = noteFiles.length > 0 && extractFiles.length > 0;
    if (btnValidate) btnValidate.disabled = !readyForValidation;
    const okToApply = Boolean(lastPreview?.resultOk);
    if (btnApply) btnApply.disabled = !okToApply;
    if (readyBadge) {
      readyBadge.className = `monthly-badge ${okToApply ? 'monthly-badge--ok' : 'monthly-badge--idle'}`;
      readyBadge.textContent = okToApply ? 'Pronto para importar' : 'Pendente';
    }
  }

  function resetPreview() {
    lastPreview = null;
    if (previewEl) previewEl.innerHTML = renderBatchPreview(null);
    refreshButtons();
  }

  async function runBatch(dryRun) {
    return apiRequest('/api/invest/import/btg-batch', {
      method: 'POST',
      body: {
        dryRun,
        async: !dryRun,
        resetFirst: resetCheckbox?.checked === true,
        mode: 'homologation',
        noteFiles,
        extractFiles,
        homeBrokerFiles,
      },
    });
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollRunStatus(runId) {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const data = await apiRequest(`/api/invest/reconcile/option-c/status/${encodeURIComponent(runId)}`);
        const state = data?.state;
        if (!state) return;
        const last = state.activityLog?.[state.activityLog.length - 1];
        if (last) appendLog(logEl, last);
        if (state.phase === 'done' || state.runStatus === 'error') {
          stopPolling();
          setStatus(
            state.phase === 'done' ? 'Importação concluída.' : `Erro: ${state.runError || 'processo bloqueado'}`,
            state.phase === 'done' ? 'ok' : 'err'
          );
          if (btnApply) btnApply.disabled = false;
          if (btnValidate) btnValidate.disabled = false;
        }
      } catch {
        /* retry */
      }
    }, 2500);
  }

  btnPickNotes?.addEventListener('click', async () => {
    try {
      const result = await pickPdfFilesFromFolder();
      noteFiles = result.files;
      if (notesLabel) notesLabel.textContent = result.fileCountLabel;
      resetPreview();
      setStatus('Notas selecionadas.');
    } catch (err) {
      setStatus(err.message || 'Seleção cancelada.', 'warn');
    }
  });

  btnPickExtracts?.addEventListener('click', async () => {
    try {
      const result = await pickExtractFilesFromFolder();
      extractFiles = result.files;
      if (extractsLabel) extractsLabel.textContent = result.fileCountLabel;
      resetPreview();
      setStatus('Extratos selecionados.');
    } catch (err) {
      setStatus(err.message || 'Seleção cancelada.', 'warn');
    }
  });

  btnPickAnchors?.addEventListener('click', async () => {
    try {
      const result = await pickHomeBrokerFilesFromFolder();
      homeBrokerFiles = result.files;
      if (anchorsLabel) anchorsLabel.textContent = result.fileCountLabel;
      resetPreview();
      setStatus('Âncoras selecionadas.');
    } catch (err) {
      setStatus(err.message || 'Seleção cancelada.', 'warn');
    }
  });

  btnValidate?.addEventListener('click', async () => {
    btnValidate.disabled = true;
    if (btnApply) btnApply.disabled = true;
    setStatus('Validando todos os meses no servidor...');
    try {
      const data = await runBatch(true);
      lastPreview = data?.preview;
      if (previewEl) previewEl.innerHTML = renderBatchPreview(lastPreview);
      const ok = Boolean(lastPreview?.resultOk);
      setStatus(
        ok ? lastPreview.summary || 'Período validado.' : 'Validação encontrou bloqueios — confira a tabela.',
        ok ? 'ok' : 'err'
      );
    } catch (err) {
      lastPreview = null;
      setStatus(err.message || 'Falha na validação.', 'err');
    } finally {
      refreshButtons();
    }
  });

  const startImport = async () => {
    btnApply.disabled = true;
    if (btnValidate) btnValidate.disabled = true;
    setStatus('Importando período completo...');
    appendLog(logEl, 'Iniciando importação em lote...');
    try {
      const data = await runBatch(false);
      if (data?.runId) {
        appendLog(logEl, `Processo ${data.runId} em segundo plano.`);
        setStatus('Importação em andamento — acompanhe o log.');
        await pollRunStatus(data.runId);
        return;
      }
      const state = data?.state;
      if (state?.activityLog?.length) {
        for (const line of state.activityLog) appendLog(logEl, line);
      }
      setStatus(data?.message || 'Importação concluída.', data?.success ? 'ok' : 'err');
    } catch (err) {
      setStatus(err.message || 'Falha na importação.', 'err');
      appendLog(logEl, err.message || 'Erro', 'err');
    } finally {
      refreshButtons();
    }
  };

  btnApply?.addEventListener('click', () => {
    if (!lastPreview?.resultOk) return;
    if (resetCheckbox?.checked) {
      showConfirmDialog(
        'Isso apaga todos os lançamentos após a abertura e reimporta o período inteiro. Deseja continuar?',
        startImport
      );
      return;
    }
    startImport();
  });

  refreshButtons();
}
