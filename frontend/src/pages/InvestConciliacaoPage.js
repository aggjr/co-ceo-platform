import '../styles/invest-conciliacao.css';
import '../styles/invest-conciliacao-modal.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import {
  pickPdfFilesFromFolder,
  pickExtractFilesFromFolder,
} from '../lib/importFilePicker.js';

/* ─────────────────────────── helpers ─────────────────────────── */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─────────────────────────── log panel ─────────────────────────── */

function appendLog(logEl, message, type = '') {
  if (!logEl) return;
  const line = document.createElement('div');
  line.className = `log-line${type ? ` log-line--${type}` : ''}`;
  line.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

/* ─────────────────────────── step cards ─────────────────────────── */

function setStepState(container, stepId, state, detail) {
  const card = container.querySelector(`[data-step="${stepId}"]`);
  if (!card) return;
  card.className = `step-card step-card--${state}`;
  const statusEl = card.querySelector('.step-card__status');
  if (statusEl && detail) statusEl.textContent = detail;
}

/* ─────────────────────────── confirm dialog ─────────────────────── */

function showConfirmDialog(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'conciliacao-confirm-overlay';
  overlay.innerHTML = `
    <div class="conciliacao-confirm-dialog">
      <h3>⚠️ Atenção: ação irreversível</h3>
      <p>${escapeHtml(message)}</p>
      <div class="btn-row">
        <button id="confirm-cancel" class="btn btn-secondary">Cancelar</button>
        <button id="confirm-ok" class="btn-reset-holding">🗑️ Sim, apagar dados</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#confirm-ok').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
}

/* ─────────────────────────── import results ─────────────────────── */

function statusBadge(ok) {
  if (ok === true) return '<span class="import-status import-status--ok">OK</span>';
  if (ok === false) return '<span class="import-status import-status--err">Erro</span>';
  return '<span class="import-status import-status--muted">—</span>';
}

function renderExtractResult(data) {
  if (!data) return '';
  const fileResults = data.preview?.fileResults || data.fileResults || [];
  const rows = fileResults.map((r) => {
    let detail = escapeHtml(r.parseError || r.importBlockReason || r.importError || (r.monthAlreadyImported ? 'Já importado' : ''));
    if (r.openingChainDelta && r.openingChainDelta !== 0) {
      const adjText = `<span style="color: #fca5a5; font-weight: 600;">⚠️ Ajuste injetado: R$ ${r.openingChainDelta.toFixed(2).replace('.', ',')}</span>`;
      detail = detail ? `${adjText}<br>${detail}` : adjText;
    }
    return `
      <tr>
        <td>${escapeHtml(r.fileName || r.path)}</td>
        <td>${escapeHtml(r.month || '—')}</td>
        <td>${statusBadge(r.parseOk)}</td>
        <td>${statusBadge(r.importOk)}</td>
        <td class="recon-detail">${detail || ''}</td>
      </tr>
    `;
  }).join('');
  const total = data.totals
    ? `<p class="recon-totals">Gravados: ${data.totals.inserted ?? 0} | Pulados: ${data.totals.skipped ?? 0}</p>`
    : '';
  const blocked = data.blockedMessage
    ? `<div class="invest-conciliacao__blocked" style="margin-top: 0.5rem">🛑 ${escapeHtml(data.blockedMessage)}</div>`
    : '';
  return `
    <table class="recon-table">
      <thead><tr><th>Arquivo</th><th>Mês</th><th>Leitura</th><th>Importação</th><th>Detalhe</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${total}${blocked}
  `;
}

function renderNotesResult(data) {
  if (!data) return '';
  const fileResults = data.preview?.fileResults || data.fileResults || [];
  const rows = fileResults.map((r) => `
    <tr>
      <td>${escapeHtml(r.path)}</td>
      <td>${statusBadge(r.parseOk)}</td>
      <td>${statusBadge(r.importOk)}</td>
      <td>${escapeHtml(r.parseError || r.importError || (r.parseOk ? `${r.notesCount ?? 0} nota(s)` : ''))}</td>
    </tr>
  `).join('');
  const total = data.totals
    ? `<p class="recon-totals">Gravados: ${data.totals.inserted ?? 0} | Pulados: ${data.totals.skipped ?? 0}</p>`
    : '';
  return `
    <table class="recon-table">
      <thead><tr><th>Arquivo</th><th>Leitura</th><th>Importação</th><th>Detalhe</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${total}
  `;
}

/* ─────────────────────────── main page ─────────────────────────── */

export async function InvestConciliacaoPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  if (isGlobalSession()) {
    await renderShell(container, {
      title: 'INVEST — Conciliação',
      contentHtml: '<div class="card"><p class="muted">Personifique o titular da holding para executar a conciliação.</p></div>',
    });
    return;
  }

  const content = `
    <div class="conciliacao-page">

      <!-- Hero -->
      <div class="conciliacao-hero">
        <div class="conciliacao-hero__icon">🔄</div>
        <div class="conciliacao-hero__content">
          <h1 class="conciliacao-hero__title">Conciliação e Reimportação Completa</h1>
          <p class="conciliacao-hero__subtitle">
            Limpa todos os dados operacionais da holding (preservando os lançamentos de inicialização),
            zera o odômetro e recalcula tudo a partir dos arquivos que você importar.
            Use quando quiser partir do zero após corrigir extratos ou notas.
          </p>
        </div>
      </div>

      <!-- Workflow steps -->
      <div class="conciliacao-steps">
        <div class="step-card step-card--active" data-step="reset">
          <span class="step-card__number">Passo 1</span>
          <span class="step-card__title">🗑️ Reset da Base</span>
          <span class="step-card__status">Aguardando execução</span>
        </div>
        <div class="step-card" data-step="import-extratos">
          <span class="step-card__number">Passo 2</span>
          <span class="step-card__title">📄 Importar Extratos</span>
          <span class="step-card__status">Aguardando reset</span>
        </div>
        <div class="step-card" data-step="import-notas">
          <span class="step-card__number">Passo 3</span>
          <span class="step-card__title">📋 Importar Notas</span>
          <span class="step-card__status">Aguardando extratos</span>
        </div>
        <div class="step-card" data-step="recalc">
          <span class="step-card__number">Passo 4</span>
          <span class="step-card__title">⚙️ Recalcular Tudo</span>
          <span class="step-card__status">Aguardando importação</span>
        </div>
      </div>

      <!-- Passo 1: Reset -->
      <div class="conciliacao-action-panel">
        <h2>Passo 1 — Reset da Base de Dados</h2>
        <p class="muted">
          Apaga lançamentos do livro razão, posições calculadas, curvas de patrimônio e snapshots BTG.
          Zera também o odômetro de armazenamento.
          <strong style="color:#ff9090"> Os lançamentos de inicialização (opening_balance) são preservados.</strong>
        </p>
        <div class="conciliacao-btn-row">
          <button id="btn-reset" class="btn-reset-holding">
            🗑️ Limpar Base de Dados
          </button>
          <span id="reset-status" class="muted" style="font-size:0.85rem"></span>
        </div>
      </div>

      <!-- Passo 2+3: Reimportar -->
      <div class="conciliacao-import-section">
        <h2>Passos 2 e 3 — Reimportar Arquivos</h2>
        <div class="conciliacao-import-grid">

          <!-- Extratos -->
          <div class="conciliacao-import-panel">
            <h3>📄 Extratos Mensais (PDF / CSV)</h3>
            <p class="muted" style="font-size:0.8rem;margin:0 0 0.75rem">Selecione a pasta com os extratos mensais.</p>
            
            <div class="invest-conciliacao__folder-row" style="border:none; padding:0; margin-bottom: 0.75rem;">
              <button id="btn-pick-extratos" class="invest-conciliacao__folder-picker" title="Escolher pasta" disabled>📂</button>
              <div class="invest-conciliacao__folder-body">
                <input type="text" id="input-path-extratos" class="invest-conciliacao__folder-path-input" placeholder="Nenhuma pasta selecionada" readonly disabled />
                <span id="label-extratos" class="invest-conciliacao__folder-count"></span>
              </div>
            </div>

            <div class="conciliacao-import-actions">
              <button id="btn-import-extratos" class="btn btn-primary" disabled>Importar Extratos</button>
            </div>
            <div id="recon-extract-result" class="conciliacao-file-result"></div>
          </div>

          <!-- Notas de corretagem -->
          <div class="conciliacao-import-panel">
            <h3>📋 Notas de Corretagem (PDF)</h3>
            <p class="muted" style="font-size:0.8rem;margin:0 0 0.75rem">Selecione a pasta com os PDFs das notas.</p>
            
            <div class="invest-conciliacao__folder-row" style="border:none; padding:0; margin-bottom: 0.75rem;">
              <button id="btn-pick-notas" class="invest-conciliacao__folder-picker" title="Escolher pasta" disabled>📂</button>
              <div class="invest-conciliacao__folder-body">
                <input type="text" id="input-path-notas" class="invest-conciliacao__folder-path-input" placeholder="Nenhuma pasta selecionada" readonly disabled />
                <span id="label-notas" class="invest-conciliacao__folder-count"></span>
              </div>
            </div>

            <div class="conciliacao-import-actions">
              <button id="btn-import-notas" class="btn btn-primary" disabled>Importar Notas</button>
            </div>
            <div id="recon-notes-result" class="conciliacao-file-result"></div>
          </div>

        </div>
      </div>

      <!-- Passo 4: Recalcular -->
      <div class="conciliacao-action-panel">
        <h2>Passo 4 — Recalcular Posições, 3 Preços e Patrimônio</h2>
        <p class="muted">
          Executa o recálculo completo: custódia, preços médios (estrito / B3 / gerencial)
          e curva de patrimônio diário. Execute após importar os arquivos.
        </p>
        <div class="conciliacao-btn-row">
          <button id="btn-recalc" class="btn-recalc-all" disabled>
            ⚙️ Recalcular Tudo
          </button>
          <span id="recalc-status" class="muted" style="font-size:0.85rem"></span>
        </div>
      </div>

      <!-- Log -->
      <div class="conciliacao-action-panel">
        <h2>Log de Operações</h2>
        <div id="conciliacao-log" class="conciliacao-log"></div>
      </div>

    </div>
  `;

  await renderShell(container, { title: 'INVEST — Conciliação', contentHtml: content });

  /* ─── DOM refs ─── */
  const logEl = container.querySelector('#conciliacao-log');
  const btnReset = container.querySelector('#btn-reset');
  
  const btnPickExtract = container.querySelector('#btn-pick-extratos');
  const inputPathExtract = container.querySelector('#input-path-extratos');
  const btnImportExtract = container.querySelector('#btn-import-extratos');
  const labelExtract = container.querySelector('#label-extratos');
  
  const btnPickNotes = container.querySelector('#btn-pick-notas');
  const inputPathNotes = container.querySelector('#input-path-notas');
  const btnImportNotes = container.querySelector('#btn-import-notas');
  const labelNotes = container.querySelector('#label-notas');
  
  const btnRecalc = container.querySelector('#btn-recalc');
  const resetStatus = container.querySelector('#reset-status');
  const recalcStatus = container.querySelector('#recalc-status');

  /* State */
  let extractFiles = [];
  let notesFiles = [];

  /* ─── Sequenciamento ─── */
  function enableStep2() {
    setStepState(container, 'import-extratos', 'active', 'Aguardando arquivos');
    btnPickExtract.disabled = false;
    inputPathExtract.disabled = false;
  }

  function enableStep3() {
    setStepState(container, 'import-notas', 'active', 'Aguardando arquivos');
    btnPickNotes.disabled = false;
    inputPathNotes.disabled = false;
  }

  function enableStep4() {
    setStepState(container, 'recalc', 'active', 'Aguardando recálculo');
    btnRecalc.disabled = false;
  }

  /* ─── PICK EXTRATOS ─── */
  btnPickExtract?.addEventListener('click', async () => {
    try {
      const result = await pickExtractFilesFromFolder();
      extractFiles = result.files;
      if (inputPathExtract) inputPathExtract.value = result.folderPath || 'Pasta selecionada';
      if (labelExtract) labelExtract.textContent = result.fileCountLabel;
      if (btnImportExtract) btnImportExtract.disabled = extractFiles.length === 0;
    } catch (err) {
      appendLog(logEl, `⚠️ Seleção cancelada: ${err.message}`, 'warn');
    }
  });

  /* ─── PICK NOTAS ─── */
  btnPickNotes?.addEventListener('click', async () => {
    try {
      const result = await pickPdfFilesFromFolder();
      notesFiles = result.files;
      if (inputPathNotes) inputPathNotes.value = result.folderPath || 'Pasta selecionada';
      if (labelNotes) labelNotes.textContent = result.fileCountLabel;
      if (btnImportNotes) btnImportNotes.disabled = notesFiles.length === 0;
    } catch (err) {
      appendLog(logEl, `⚠️ Seleção cancelada: ${err.message}`, 'warn');
    }
  });

  /* ─── RESET ─── */
  btnReset?.addEventListener('click', () => {
    showConfirmDialog(
      'Isso apagará TODOS os lançamentos do livro razão, posições, curva de patrimônio e snapshots BTG desta holding. Apenas os lançamentos de inicialização (opening_balance) serão preservados. Esta operação NÃO pode ser desfeita.',
      async () => {
        btnReset.disabled = true;
        if (resetStatus) resetStatus.textContent = 'Executando reset...';
        setStepState(container, 'reset', 'active', 'Executando...');
        appendLog(logEl, '─── Iniciando Reset da Base ───', 'section');

        try {
          const data = await apiRequest('/api/invest/reconcile/reset-holding', {
            method: 'POST',
            body: {},
          });

          if (data.success) {
            appendLog(logEl, '✅ Reset concluído com sucesso.', 'ok');
            for (const step of (data.report?.steps || [])) {
              appendLog(logEl, `  ${step.step}: ${step.detail}`);
            }
            setStepState(container, 'reset', 'done', '✅ Concluído');
            if (resetStatus) resetStatus.textContent = '✅ Base limpa. Siga para o Passo 2.';
            
            enableStep2(); // Habilita extratos

          } else {
            throw new Error(data.error || 'Falha no reset.');
          }
        } catch (err) {
          appendLog(logEl, `❌ Erro no reset: ${err.message}`, 'err');
          setStepState(container, 'reset', 'error', '❌ ' + err.message);
          if (resetStatus) resetStatus.textContent = '❌ ' + err.message;
          btnReset.disabled = false;
        }
      }
    );
  });

  /* ─── IMPORTAR EXTRATOS ─── */
  btnImportExtract?.addEventListener('click', async () => {
    if (!extractFiles.length) return;
    btnImportExtract.disabled = true;
    btnPickExtract.disabled = true;
    setStepState(container, 'import-extratos', 'active', `Importando ${extractFiles.length} arquivo(s)...`);
    appendLog(logEl, `─── Importando ${extractFiles.length} extrato(s) ───`, 'section');

    try {
      const data = await apiRequest('/api/invest/import/btg-extract', {
        method: 'POST',
        body: { files: extractFiles, dryRun: false },
      });

      const fileResults = data.preview?.fileResults || data.fileResults || [];
      const ok = fileResults.filter((r) => r.importOk).length;
      const err = fileResults.filter((r) => r.importOk === false).length;

      appendLog(logEl, `✅ Extratos: ${ok} importados, ${err} com erro.`, ok > 0 ? 'ok' : 'warn');
      setStepState(container, 'import-extratos', err === 0 ? 'done' : 'error',
        err === 0 ? `✅ ${ok} extrato(s)` : `⚠️ ${err} erro(s)`);

      const resultEl = container.querySelector('#recon-extract-result');
      if (resultEl) resultEl.innerHTML = renderExtractResult(data);

      enableStep3(); // Habilita notas após importar extratos

    } catch (err) {
      appendLog(logEl, `❌ Erro nos extratos: ${err.message}`, 'err');
      setStepState(container, 'import-extratos', 'error', '❌ ' + err.message);
      btnImportExtract.disabled = false;
      btnPickExtract.disabled = false;
    }
  });

  /* ─── IMPORTAR NOTAS ─── */
  btnImportNotes?.addEventListener('click', async () => {
    if (!notesFiles.length) return;
    btnImportNotes.disabled = true;
    btnPickNotes.disabled = true;
    setStepState(container, 'import-notas', 'active', `Importando ${notesFiles.length} nota(s)...`);
    appendLog(logEl, `─── Importando ${notesFiles.length} nota(s) de corretagem ───`, 'section');

    try {
      const data = await apiRequest('/api/invest/import/btg-brokerage-notes', {
        method: 'POST',
        body: { files: notesFiles, dryRun: false },
      });

      const fileResults = data.preview?.fileResults || data.fileResults || [];
      const ok = fileResults.filter((r) => r.importOk).length;
      const err = fileResults.filter((r) => r.importOk === false).length;

      appendLog(logEl, `✅ Notas: ${ok} importadas, ${err} com erro.`, ok > 0 ? 'ok' : 'warn');
      setStepState(container, 'import-notas', err === 0 ? 'done' : 'error',
        err === 0 ? `✅ ${ok} nota(s)` : `⚠️ ${err} erro(s)`);

      const resultEl = container.querySelector('#recon-notes-result');
      if (resultEl) resultEl.innerHTML = renderNotesResult(data);

      enableStep4(); // Habilita recálculo após importar notas

    } catch (err) {
      appendLog(logEl, `❌ Erro nas notas: ${err.message}`, 'err');
      setStepState(container, 'import-notas', 'error', '❌ ' + err.message);
      btnImportNotes.disabled = false;
      btnPickNotes.disabled = false;
    }
  });

  /* ─── RECALCULAR TUDO ─── */
  btnRecalc?.addEventListener('click', async () => {
    btnRecalc.disabled = true;
    if (recalcStatus) recalcStatus.textContent = 'Recalculando...';
    setStepState(container, 'recalc', 'active', 'Recalculando...');
    appendLog(logEl, '─── Recalculando posições, 3 preços e patrimônio ───', 'section');

    try {
      appendLog(logEl, 'Recalculando posições e preços médios...', 'info');
      const posData = await apiRequest('/api/invest/admin/recalc-positions', {
        method: 'POST',
        body: {},
      });
      if (posData.success) {
        appendLog(logEl, `✅ Posições: ${posData.updated ?? posData.processed ?? '?'} ativos atualizados.`, 'ok');
      } else {
        appendLog(logEl, `⚠️ Posições: ${posData.error || 'Resposta inesperada'}`, 'warn');
      }

      appendLog(logEl, 'Recalculando curva de patrimônio diário...', 'info');
      const curveData = await apiRequest('/api/invest/admin/recalc-curve', {
        method: 'POST',
        body: {},
      });
      if (curveData.success) {
        appendLog(logEl, `✅ Curva: ${curveData.processed ?? '?'} dias calculados.`, 'ok');
      } else {
        appendLog(logEl, `⚠️ Curva: ${curveData.error || 'Resposta inesperada'}`, 'warn');
      }

      setStepState(container, 'recalc', 'done', '✅ Recálculo concluído');
      if (recalcStatus) recalcStatus.textContent = '✅ Tudo recalculado!';
      appendLog(logEl, '🎉 Processo completo! Verifique os saldos nas telas de Ações/FIIs e Panorama.', 'ok');
    } catch (err) {
      appendLog(logEl, `❌ Erro no recálculo: ${err.message}`, 'err');
      setStepState(container, 'recalc', 'error', '❌ ' + err.message);
      if (recalcStatus) recalcStatus.textContent = '❌ ' + err.message;
      btnRecalc.disabled = false;
    }
  });
}
