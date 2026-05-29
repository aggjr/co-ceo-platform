import '../styles/invest-conciliacao.css';
import '../styles/invest-importacao.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { bindImportFilePicker } from '../lib/importFilePicker.js';

/* ─────────────────────────── helpers ─────────────────────────── */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readFilesAsPayload(fileList) {
  return Promise.all(
    [...fileList].map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const raw = String(reader.result || '');
            const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
            const rel = file.webkitRelativePath || file.name;
            resolve({ name: rel, contentBase64: base64 });
          };
          reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
          reader.readAsDataURL(file);
        })
    )
  );
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
        <button id="confirm-cancel" class="btn">Cancelar</button>
        <button id="confirm-ok" class="btn-reset-holding">Sim, executar reset</button>
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

function renderExtractResult(result) {
  if (!result) return '';
  const rows = (result.fileResults || []).map((r) => `
    <tr>
      <td>${escapeHtml(r.fileName || r.path)}</td>
      <td>${escapeHtml(r.month || '—')}</td>
      <td>${statusBadge(r.parseOk)}</td>
      <td>${statusBadge(r.importOk)}</td>
      <td class="import-detail-cell">${escapeHtml(r.parseError || r.importError || (r.monthAlreadyImported ? 'Já importado' : ''))}</td>
    </tr>
  `).join('');
  const total = result.totals
    ? `<p class="muted" style="font-size:0.78rem;margin-top:0.5rem">Gravados: ${result.totals.inserted ?? 0} | Pulados: ${result.totals.skipped ?? 0}</p>`
    : '';
  return `
    <table class="import-status-table" style="font-size:0.78rem">
      <thead><tr><th>Arquivo</th><th>Mês</th><th>Leitura</th><th>Importação</th><th>Detalhe</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${total}
  `;
}

function renderNotesResult(result) {
  if (!result) return '';
  const rows = (result.fileResults || []).map((r) => `
    <tr>
      <td>${escapeHtml(r.path)}</td>
      <td>${statusBadge(r.parseOk)}</td>
      <td>${statusBadge(r.importOk)}</td>
      <td>${escapeHtml(r.parseError || r.importError || (r.parseOk ? `${r.notesCount ?? 0} nota(s)` : ''))}</td>
    </tr>
  `).join('');
  const total = result.totals
    ? `<p class="muted" style="font-size:0.78rem;margin-top:0.5rem">Gravados: ${result.totals.inserted ?? 0} | Pulados: ${result.totals.skipped ?? 0}</p>`
    : '';
  return `
    <table class="import-status-table" style="font-size:0.78rem">
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
        <div class="step-card" data-step="reset">
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
          <span class="step-card__status">Aguardando reset</span>
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
            🗑️ Executar Reset
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
            <div class="import-picker">
              <div class="import-picker-row">
                <input type="file" id="recon-extract-dir" class="import-picker-input" webkitdirectory directory multiple />
                <button type="button" class="import-picker-btn" id="recon-extract-dir-btn">
                  <span>📂</span><span>Escolher pasta</span>
                </button>
                <span class="import-picker-name" id="recon-extract-dir-label">Nenhuma pasta</span>
              </div>
            </div>
            <div class="import-picker" style="margin-top:0.5rem">
              <div class="import-picker-row">
                <input type="file" id="recon-extract-files" class="import-picker-input" accept=".pdf,.csv,.txt" multiple />
                <button type="button" class="import-picker-btn" id="recon-extract-files-btn">
                  <span>📄</span><span>Arquivos avulsos</span>
                </button>
                <span class="import-picker-name" id="recon-extract-files-label">Nenhum arquivo</span>
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
            <div class="import-picker">
              <div class="import-picker-row">
                <input type="file" id="recon-notes-dir" class="import-picker-input" webkitdirectory directory multiple />
                <button type="button" class="import-picker-btn" id="recon-notes-dir-btn">
                  <span>📂</span><span>Escolher pasta</span>
                </button>
                <span class="import-picker-name" id="recon-notes-dir-label">Nenhuma pasta</span>
              </div>
            </div>
            <div class="import-picker" style="margin-top:0.5rem">
              <div class="import-picker-row">
                <input type="file" id="recon-notes-files" class="import-picker-input" accept=".pdf" multiple />
                <button type="button" class="import-picker-btn" id="recon-notes-files-btn">
                  <span>📄</span><span>Arquivos avulsos</span>
                </button>
                <span class="import-picker-name" id="recon-notes-files-label">Nenhum arquivo</span>
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
  const btnImportExtract = container.querySelector('#btn-import-extratos');
  const btnImportNotes = container.querySelector('#btn-import-notas');
  const btnRecalc = container.querySelector('#btn-recalc');
  const resetStatus = container.querySelector('#reset-status');
  const recalcStatus = container.querySelector('#recalc-status');

  /* ─── File pickers ─── */
  bindImportFilePicker(container, {
    inputSelector: '#recon-extract-dir',
    buttonSelector: '#recon-extract-dir-btn',
    labelSelector: '#recon-extract-dir-label',
    emptyLabel: 'Nenhuma pasta',
    onChange: () => {},
  });
  bindImportFilePicker(container, {
    inputSelector: '#recon-extract-files',
    buttonSelector: '#recon-extract-files-btn',
    labelSelector: '#recon-extract-files-label',
    emptyLabel: 'Nenhum arquivo',
    onChange: () => {},
  });
  bindImportFilePicker(container, {
    inputSelector: '#recon-notes-dir',
    buttonSelector: '#recon-notes-dir-btn',
    labelSelector: '#recon-notes-dir-label',
    emptyLabel: 'Nenhuma pasta',
    onChange: () => {},
  });
  bindImportFilePicker(container, {
    inputSelector: '#recon-notes-files',
    buttonSelector: '#recon-notes-files-btn',
    labelSelector: '#recon-notes-files-label',
    emptyLabel: 'Nenhum arquivo',
    onChange: () => {},
  });

  /* ─── RESET ─── */
  btnReset?.addEventListener('click', () => {
    showConfirmDialog(
      'Isso apagará TODOS os lançamentos do livro razão, posições, curva de patrimônio e snapshots BTG desta holding. ' +
      'Apenas os lançamentos de inicialização (opening_balance) serão preservados. ' +
      'Esta operação NÃO pode ser desfeita.',
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
            if (resetStatus) resetStatus.textContent = '✅ Base limpa. Agora importe os arquivos.';
            if (btnImportExtract) btnImportExtract.disabled = false;
            if (btnImportNotes) btnImportNotes.disabled = false;
            if (btnRecalc) btnRecalc.disabled = false;
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
    const dirInput = container.querySelector('#recon-extract-dir');
    const fileInput = container.querySelector('#recon-extract-files');
    const allFiles = [...(dirInput?.files || []), ...(fileInput?.files || [])];
    const extracts = allFiles.filter((f) => /\.(pdf|csv|txt)$/i.test(f.name));

    if (!extracts.length) {
      appendLog(logEl, '⚠️ Selecione uma pasta ou arquivos de extratos.', 'warn');
      return;
    }

    btnImportExtract.disabled = true;
    setStepState(container, 'import-extratos', 'active', `Importando ${extracts.length} arquivo(s)...`);
    appendLog(logEl, `─── Importando ${extracts.length} extrato(s) ───`, 'section');

    try {
      const files = await readFilesAsPayload(extracts);
      const data = await apiRequest('/api/invest/import/btg-extract', {
        method: 'POST',
        body: { files, dryRun: false },
      });

      const fileResults = data.preview?.fileResults || data.fileResults || [];
      const ok = fileResults.filter((r) => r.importOk).length;
      const err = fileResults.filter((r) => r.importOk === false).length;

      appendLog(logEl, `✅ Extratos: ${ok} importados, ${err} com erro.`, ok > 0 ? 'ok' : 'warn');
      setStepState(container, 'import-extratos', err === 0 ? 'done' : 'error',
        err === 0 ? `✅ ${ok} extrato(s) importados` : `⚠️ ${err} erro(s)`);

      const resultEl = container.querySelector('#recon-extract-result');
      if (resultEl) resultEl.innerHTML = renderExtractResult({ ...data, fileResults });
    } catch (err) {
      appendLog(logEl, `❌ Erro nos extratos: ${err.message}`, 'err');
      setStepState(container, 'import-extratos', 'error', '❌ ' + err.message);
    } finally {
      btnImportExtract.disabled = false;
    }
  });

  /* ─── IMPORTAR NOTAS ─── */
  btnImportNotes?.addEventListener('click', async () => {
    const dirInput = container.querySelector('#recon-notes-dir');
    const fileInput = container.querySelector('#recon-notes-files');
    const allFiles = [...(dirInput?.files || []), ...(fileInput?.files || [])];
    const pdfs = allFiles.filter((f) => /\.pdf$/i.test(f.name));

    if (!pdfs.length) {
      appendLog(logEl, '⚠️ Selecione uma pasta ou arquivos PDF de notas.', 'warn');
      return;
    }

    btnImportNotes.disabled = true;
    setStepState(container, 'import-notas', 'active', `Importando ${pdfs.length} nota(s)...`);
    appendLog(logEl, `─── Importando ${pdfs.length} nota(s) de corretagem ───`, 'section');

    try {
      const files = await readFilesAsPayload(pdfs);
      const data = await apiRequest('/api/invest/import/btg-brokerage-notes', {
        method: 'POST',
        body: { files, dryRun: false },
      });

      const fileResults = data.preview?.fileResults || data.fileResults || [];
      const ok = fileResults.filter((r) => r.importOk).length;
      const err = fileResults.filter((r) => r.importOk === false).length;

      appendLog(logEl, `✅ Notas: ${ok} importadas, ${err} com erro.`, ok > 0 ? 'ok' : 'warn');
      setStepState(container, 'import-notas', err === 0 ? 'done' : 'error',
        err === 0 ? `✅ ${ok} nota(s) importadas` : `⚠️ ${err} erro(s)`);

      const resultEl = container.querySelector('#recon-notes-result');
      if (resultEl) resultEl.innerHTML = renderNotesResult({ ...data, fileResults });
    } catch (err) {
      appendLog(logEl, `❌ Erro nas notas: ${err.message}`, 'err');
      setStepState(container, 'import-notas', 'error', '❌ ' + err.message);
    } finally {
      btnImportNotes.disabled = false;
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
