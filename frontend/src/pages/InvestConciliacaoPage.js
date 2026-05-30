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

/** Mensagem amigável + detalhe técnico (MySQL/gateway) para o painel de log. */
function formatReconcileApiError(err) {
  const base = err?.message || String(err);
  const d = err?.body?.errorDetail;
  if (!d) return base;
  const parts = [base];
  if (d.code) parts.push(`código: ${d.code}`);
  if (d.errno != null) parts.push(`errno: ${d.errno}`);
  if (d.sqlMessage) parts.push(`SQL: ${d.sqlMessage}`);
  if (d.context && Object.keys(d.context).length) {
    parts.push(`ctx: ${JSON.stringify(d.context)}`);
  }
  return parts.join(' · ');
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

const RECON_ACTION_LABELS = {
  insert_from_file: 'Inserir do arquivo',
  void_ledger: 'Anular no livro',
  pair_rows: 'Parear linhas',
  keep_ledger_row: 'Manter livro',
  confirm_skipped: 'Aceitar e continuar',
  defer: 'Adiar',
};

function renderPendingDecisions(pending) {
  if (!pending?.length) {
    return '<p class="muted">Nenhuma pendência — pode fechar o dia.</p>';
  }
  return pending.map((d) => {
    const ctx = d.context || {};
    const actions = (d.allowedActions || [])
      .map((a) => `<button type="button" class="btn btn-sm btn-secondary wizard-resolve" data-decision-id="${escapeHtml(d.decisionId)}" data-action="${escapeHtml(a)}">${escapeHtml(RECON_ACTION_LABELS[a] || a)}</button>`)
      .join(' ');
    return `
      <div class="invest-conciliacao__pending-item" data-decision-id="${escapeHtml(d.decisionId)}">
        <strong>${escapeHtml(d.kind || d.summaryKey || 'pendência')}</strong>
        <span class="muted">${escapeHtml(ctx.ticker || '')} · qtd ${escapeHtml(String(ctx.quantity ?? '—'))} · R$ ${escapeHtml(String(ctx.unitPrice ?? '—'))}</span>
        <div class="conciliacao-btn-row" style="margin-top:0.5rem">${actions}</div>
      </div>`;
  }).join('');
}

function renderDayPreviewRows(rows) {
  if (!rows?.length) return '<tr><td colspan="5" class="muted">Sem linhas</td></tr>';
  return rows.map((r) => `
    <tr data-row-key="${escapeHtml(r.rowKey)}">
      <td>${escapeHtml(r.source || '—')}</td>
      <td>${escapeHtml(r.ticker || '—')}</td>
      <td>${escapeHtml(String(r.quantity ?? '—'))}</td>
      <td>${escapeHtml(String(r.unitPrice ?? '—'))}</td>
      <td>${escapeHtml(r.status || '—')}</td>
    </tr>
  `).join('');
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
            Três modos: <strong>Opção C</strong> (recomendado) fecha cada pregão com cotações da web e patrimônio gravado;
            fluxo rápido em 4 passos; ou wizard manual dia a dia.
          </p>
        </div>
      </div>

      <!-- Opção C — fechamento calmo dia a dia (recomendado) -->
      <div class="conciliacao-action-panel invest-conciliacao__option-c" id="option-c-panel">
        <h2>Opção C — Fechamento calmo dia a dia (recomendado)</h2>
        <p class="muted">
          Reset → indique <strong>as duas pastas</strong> (notas + extratos) → o sistema fecha cada pregão com
          cotações brapi/opcoes.net, grava patrimônio diário, recalcula custódia e os 3 preços (zeram quando a posição zera).
          Para em divergências — resolva e continue.
        </p>
        <div class="conciliacao-import-grid">
          <div class="conciliacao-import-panel">
            <h3>📋 Pasta das notas (PDF)</h3>
            <div class="invest-conciliacao__folder-row" style="border:none;padding:0;margin-bottom:0.5rem">
              <button id="btn-pick-optc-notas" class="invest-conciliacao__folder-picker" title="Notas">📂</button>
              <div class="invest-conciliacao__folder-body">
                <input id="input-path-optc-notas" class="invest-conciliacao__folder-path-input" placeholder="Pasta notas" readonly />
                <span id="label-optc-notas" class="invest-conciliacao__folder-count"></span>
              </div>
            </div>
          </div>
          <div class="conciliacao-import-panel">
            <h3>📄 Pasta dos extratos (PDF/CSV)</h3>
            <div class="invest-conciliacao__folder-row" style="border:none;padding:0;margin-bottom:0.5rem">
              <button id="btn-pick-optc-extratos" class="invest-conciliacao__folder-picker" title="Extratos">📂</button>
              <div class="invest-conciliacao__folder-body">
                <input id="input-path-optc-extratos" class="invest-conciliacao__folder-path-input" placeholder="Pasta extratos" readonly />
                <span id="label-optc-extratos" class="invest-conciliacao__folder-count"></span>
              </div>
            </div>
          </div>
        </div>
        <div class="conciliacao-btn-row">
          <button id="btn-optc-seed-anchors" class="btn btn-secondary" type="button">
            Carregar âncoras BTG (homebroker)
          </button>
          <span id="optc-anchors-status" class="muted" style="font-size:0.85rem"></span>
        </div>
        <div class="conciliacao-btn-row">
          <label class="invest-conciliacao__check-row">
            <input type="checkbox" id="optc-reset-first" class="invest-conciliacao__checkbox" checked />
            Reset antes de iniciar (preserva abertura)
          </label>
        </div>
        <div class="conciliacao-btn-row">
          <button id="btn-optc-start" class="btn btn-primary" disabled>Iniciar Opção C</button>
          <button id="btn-optc-next-day" class="btn btn-secondary" disabled>Fechamento do próximo dia</button>
          <button id="btn-optc-run-all" class="btn btn-secondary" disabled>Fechar todos (calmo)</button>
          <span id="optc-status" class="muted" style="font-size:0.85rem"></span>
        </div>
        <div id="optc-progress" class="invest-conciliacao__progress-wrap" hidden>
          <div class="invest-conciliacao__progress-label" id="optc-progress-label"></div>
          <div class="invest-conciliacao__progress-track"><div class="invest-conciliacao__progress-bar" id="optc-progress-bar"></div></div>
        </div>
        <div id="optc-pending" class="invest-conciliacao__pending" style="margin-top:1rem"></div>
      </div>

      <!-- Wizard dia a dia (manual) -->
      <div class="conciliacao-action-panel invest-conciliacao__wizard-setup" id="wizard-setup">
        <h2>Modo preciso — conciliação dia a dia</h2>
        <p class="muted">
          Para bater centavo a centavo: selecione a pasta de notas, inicie a sessão e resolva cada
          pendência antes de fechar o pregão. Depois continue com extratos (Passo 3) e materialização.
        </p>
        <div class="invest-conciliacao__folder-row" style="margin-bottom: 0.75rem;">
          <button id="btn-pick-wizard-notas" class="invest-conciliacao__folder-picker" title="Escolher pasta de notas">📂</button>
          <div class="invest-conciliacao__folder-body">
            <input type="text" id="input-path-wizard-notas" class="invest-conciliacao__folder-path-input" placeholder="Pasta de PDFs das notas" readonly />
            <span id="label-wizard-notas" class="invest-conciliacao__folder-count"></span>
          </div>
        </div>
        <div class="conciliacao-btn-row">
          <button id="btn-wizard-start" class="btn btn-primary" disabled>Iniciar sessão (notas)</button>
          <span id="wizard-start-status" class="muted" style="font-size:0.85rem"></span>
        </div>
        <div id="wizard-workflow" class="invest-conciliacao__workflow" hidden>
          <div class="invest-conciliacao__toolbar">
            <label>Dia:</label>
            <select id="wizard-day-select"></select>
            <button id="btn-wizard-load-day" class="btn btn-secondary btn-sm">Carregar dia</button>
            <button id="btn-wizard-close-day" class="btn btn-primary btn-sm" disabled>Fechar dia</button>
            <span id="wizard-day-status" class="muted"></span>
          </div>
          <div class="conciliacao-action-panel" style="margin-top:1rem">
            <h3>Pendências do dia</h3>
            <div id="wizard-pending" class="invest-conciliacao__pending"></div>
          </div>
          <div class="invest-conciliacao__tables">
            <div class="invest-conciliacao__table-wrap">
              <h4>Livro × arquivo</h4>
              <table class="invest-conciliacao__table">
                <thead><tr><th>Origem</th><th>Ticker</th><th>Qtd</th><th>Preço</th><th>Status</th></tr></thead>
                <tbody id="wizard-preview-rows"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Workflow steps -->
      <div class="conciliacao-steps">
        <div class="step-card step-card--active" data-step="reset">
          <span class="step-card__number">Passo 1</span>
          <span class="step-card__title">🗑️ Reset da Base</span>
          <span class="step-card__status">Aguardando execução</span>
        </div>
        <div class="step-card" data-step="import-notas">
          <span class="step-card__number">Passo 2</span>
          <span class="step-card__title">📋 Importar Notas</span>
          <span class="step-card__status">Aguardando reset</span>
        </div>
        <div class="step-card" data-step="import-extratos">
          <span class="step-card__number">Passo 3</span>
          <span class="step-card__title">📄 Importar Extratos</span>
          <span class="step-card__status">Aguardando notas</span>
        </div>
        <div class="step-card" data-step="recalc">
          <span class="step-card__number">Passo 4</span>
          <span class="step-card__title">⚙️ Materializar Tudo</span>
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
        <h2>Passos 2 e 3 — Reimportar (notas primeiro, extratos depois)</h2>
        <div class="conciliacao-import-grid">

          <!-- Notas de corretagem (obrigatório primeiro) -->
          <div class="conciliacao-import-panel">
            <h3>📋 Notas de Corretagem (PDF) — Passo 2</h3>
            <p class="muted" style="font-size:0.8rem;margin:0 0 0.75rem">Pasta com PDFs das notas. Importe todas antes do extrato.</p>
            
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

          <!-- Extratos -->
          <div class="conciliacao-import-panel">
            <h3>📄 Extratos Mensais (PDF / CSV) — Passo 3</h3>
            <p class="muted" style="font-size:0.8rem;margin:0 0 0.75rem">Pasta com extratos mensais BTG (após as notas).</p>
            
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

        </div>
      </div>

      <!-- Passo 4: Recalcular -->
      <div class="conciliacao-action-panel">
        <h2>Passo 4 — Materializar (custódia, 3 preços, patrimônio diário)</h2>
        <p class="muted">
          Grava fechamentos em <code>invest_portfolio_daily</code> (mtm_economic), recalcula custódia e
          os três preços (estrito / B3 / gerencial). Use após notas e extratos sem erro bloqueante.
        </p>
        <div class="conciliacao-btn-row">
          <button id="btn-recalc" class="btn-recalc-all" disabled>
            ⚙️ Materializar Tudo
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

  /* ─── Sequenciamento (notas → extratos → materializar) ─── */
  function enableStep2() {
    setStepState(container, 'import-notas', 'active', 'Aguardando arquivos');
    btnPickNotes.disabled = false;
    inputPathNotes.disabled = false;
  }

  function enableStep3() {
    setStepState(container, 'import-extratos', 'active', 'Aguardando arquivos');
    btnPickExtract.disabled = false;
    inputPathExtract.disabled = false;
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
            const report = data.report || {};
            if (report.openingDate) {
              appendLog(logEl, `  Abertura preservada: ${report.openingDate} (${report.openingLegCount ?? '?'} perna(s))`);
            }
            if (report.patrimonyLegsRemoved != null) {
              appendLog(logEl, `  Lançamentos removidos: patrimônio ${report.patrimonyLegsRemoved}, financeiros ${report.financialLegsRemoved ?? 0}`);
            }
            if (report.auxRowsRemoved != null) {
              appendLog(logEl, `  Linhas auxiliares removidas: ${report.auxRowsRemoved}`);
            }
            for (const line of report.activityLog || []) {
              appendLog(logEl, `  ${line}`);
            }
            setStepState(container, 'reset', 'done', '✅ Concluído');
            if (resetStatus) resetStatus.textContent = '✅ Base limpa. Importe as NOTAS (Passo 2).';

            enableStep2();

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

  /* ─── IMPORTAR NOTAS (Passo 2) ─── */
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

      if (err === 0) {
        enableStep3();
      } else {
        btnImportNotes.disabled = false;
        btnPickNotes.disabled = false;
      }
    } catch (err) {
      appendLog(logEl, `❌ Erro nas notas: ${err.message}`, 'err');
      setStepState(container, 'import-notas', 'error', '❌ ' + err.message);
      btnImportNotes.disabled = false;
      btnPickNotes.disabled = false;
    }
  });

  /* ─── IMPORTAR EXTRATOS (Passo 3) ─── */
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

      if (err === 0) {
        enableStep4();
      } else {
        btnImportExtract.disabled = false;
        btnPickExtract.disabled = false;
      }
    } catch (err) {
      appendLog(logEl, `❌ Erro nos extratos: ${err.message}`, 'err');
      setStepState(container, 'import-extratos', 'error', '❌ ' + err.message);
      btnImportExtract.disabled = false;
      btnPickExtract.disabled = false;
    }
  });

  btnRecalc?.addEventListener('click', async () => {
    btnRecalc.disabled = true;
    if (recalcStatus) recalcStatus.textContent = 'Materializando...';
    setStepState(container, 'recalc', 'active', 'Materializando...');
    appendLog(logEl, '─── Materialização: custódia, 3 preços, patrimônio diário ───', 'section');

    try {
      const data = await apiRequest('/api/invest/reconcile/recalc-all', {
        method: 'POST',
        body: {},
      });

      if (!data.success) {
        throw new Error(data.error || 'Falha na materialização.');
      }

      const pos = data.positions || {};
      const rebuild = data.patrimonyRebuild || {};
      appendLog(logEl, `✅ Custódia reconciliada.`, 'ok');
      appendLog(logEl, `✅ Posições: ${pos.updated ?? pos.processed ?? '?'} ativo(s) com 3 preços.`, 'ok');
      appendLog(logEl, `✅ Patrimônio diário: ${rebuild.daysWritten ?? '?'} dia(s) gravados (${rebuild.daysSkipped ?? 0} pulados).`, 'ok');
      if (Array.isArray(rebuild.warnings) && rebuild.warnings.length) {
        for (const w of rebuild.warnings) {
          appendLog(logEl, `⚠️ ${w}`, 'warn');
        }
      }

      setStepState(container, 'recalc', 'done', '✅ Materialização concluída');
      if (recalcStatus) recalcStatus.textContent = '✅ Concluído — confira Resultado histórico e Ações/FIIs.';
      appendLog(logEl, '🎉 Processo completo! Verifique TWR em Resultado histórico e os 3 preços em Ações/FIIs.', 'ok');
    } catch (err) {
      appendLog(logEl, `❌ Erro na materialização: ${err.message}`, 'err');
      setStepState(container, 'recalc', 'error', '❌ ' + err.message);
      if (recalcStatus) recalcStatus.textContent = '❌ ' + err.message;
      btnRecalc.disabled = false;
    }
  });

  /* ─── Wizard dia a dia ─── */
  const btnPickWizardNotes = container.querySelector('#btn-pick-wizard-notas');
  const inputPathWizardNotes = container.querySelector('#input-path-wizard-notas');
  const labelWizardNotes = container.querySelector('#label-wizard-notas');
  const btnWizardStart = container.querySelector('#btn-wizard-start');
  const wizardStartStatus = container.querySelector('#wizard-start-status');
  const wizardWorkflow = container.querySelector('#wizard-workflow');
  const wizardDaySelect = container.querySelector('#wizard-day-select');
  const btnWizardLoadDay = container.querySelector('#btn-wizard-load-day');
  const btnWizardCloseDay = container.querySelector('#btn-wizard-close-day');
  const wizardDayStatus = container.querySelector('#wizard-day-status');
  const wizardPending = container.querySelector('#wizard-pending');
  const wizardPreviewRows = container.querySelector('#wizard-preview-rows');

  let wizardNotesFiles = [];
  let wizardSessionId = null;
  let wizardCalendar = [];
  let wizardCurrentDay = null;

  btnPickWizardNotes?.addEventListener('click', async () => {
    try {
      const result = await pickPdfFilesFromFolder();
      wizardNotesFiles = result.files;
      if (inputPathWizardNotes) inputPathWizardNotes.value = result.folderPath || 'Pasta selecionada';
      if (labelWizardNotes) labelWizardNotes.textContent = result.fileCountLabel;
      if (btnWizardStart) btnWizardStart.disabled = wizardNotesFiles.length === 0;
    } catch (err) {
      appendLog(logEl, `⚠️ Wizard: ${err.message}`, 'warn');
    }
  });

  async function loadWizardDay(date) {
    if (!wizardSessionId || !date) return;
    wizardCurrentDay = date;
    if (wizardDayStatus) wizardDayStatus.textContent = 'Carregando...';
    try {
      const data = await apiRequest(
        `/api/invest/reconcile/session/${encodeURIComponent(wizardSessionId)}/day/${encodeURIComponent(date)}`
      );
      if (wizardPending) {
        wizardPending.innerHTML = renderPendingDecisions(data.pendingDecisions || []);
        wizardPending.querySelectorAll('.wizard-resolve').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const decisionId = btn.getAttribute('data-decision-id');
            const action = btn.getAttribute('data-action');
            try {
              await apiRequest(
                `/api/invest/reconcile/session/${encodeURIComponent(wizardSessionId)}/day/${encodeURIComponent(date)}/resolve`,
                { method: 'POST', body: { decisionId, action } }
              );
              appendLog(logEl, `✅ Pendência resolvida (${action})`, 'ok');
              await loadWizardDay(date);
            } catch (err) {
              appendLog(logEl, `❌ Resolver: ${err.message}`, 'err');
            }
          });
        });
      }
      if (wizardPreviewRows) {
        const rows = data.preview?.rows || [];
        wizardPreviewRows.innerHTML = renderDayPreviewRows(rows);
      }
      if (btnWizardCloseDay) btnWizardCloseDay.disabled = !data.canClose;
      if (wizardDayStatus) {
        wizardDayStatus.textContent = data.canClose
          ? '✅ Sem pendências — pode fechar'
          : `⚠️ ${(data.pendingDecisions || []).length} pendência(s)`;
      }
    } catch (err) {
      if (wizardDayStatus) wizardDayStatus.textContent = '❌ ' + err.message;
      appendLog(logEl, `❌ Dia ${date}: ${err.message}`, 'err');
    }
  }

  btnWizardStart?.addEventListener('click', async () => {
    if (!wizardNotesFiles.length) return;
    btnWizardStart.disabled = true;
    if (wizardStartStatus) wizardStartStatus.textContent = 'Iniciando sessão...';
    try {
      let dataMode;
      const pf = await apiRequest('/api/invest/reconcile/preflight');
      if (pf.needsDataModeChoice) {
        const recover = window.confirm(
          'Há dados operacionais na holding.\n\nOK = recuperar (preservar)\nCancelar = reset (refazer do zero, preserva abertura)'
        );
        dataMode = recover ? 'recover' : 'reset_from_opening';
      }
      const data = await apiRequest('/api/invest/reconcile/session/start', {
        method: 'POST',
        body: { phase: 'notes', files: wizardNotesFiles, dataMode },
      });
      wizardSessionId = data.sessionId;
      wizardCalendar = data.calendar || [];
      if (wizardWorkflow) wizardWorkflow.hidden = false;
      if (wizardDaySelect) {
        wizardDaySelect.innerHTML = wizardCalendar
          .map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`)
          .join('');
      }
      appendLog(logEl, `✅ Sessão ${wizardSessionId} — ${wizardCalendar.length} dia(s)`, 'ok');
      if (wizardStartStatus) wizardStartStatus.textContent = 'Sessão ativa';
      enableStep2();
      enableStep3();
      if (wizardCalendar.length) await loadWizardDay(wizardCalendar[0]);
    } catch (err) {
      appendLog(logEl, `❌ Sessão: ${err.message}`, 'err');
      if (wizardStartStatus) wizardStartStatus.textContent = '❌ ' + err.message;
      btnWizardStart.disabled = false;
    }
  });

  btnWizardLoadDay?.addEventListener('click', () => {
    const date = wizardDaySelect?.value;
    if (date) void loadWizardDay(date);
  });

  btnWizardCloseDay?.addEventListener('click', async () => {
    const date = wizardCurrentDay || wizardDaySelect?.value;
    if (!wizardSessionId || !date) return;
    btnWizardCloseDay.disabled = true;
    try {
      await apiRequest(
        `/api/invest/reconcile/session/${encodeURIComponent(wizardSessionId)}/day/${encodeURIComponent(date)}/close`,
        { method: 'POST', body: {} }
      );
      appendLog(logEl, `✅ Dia ${date} fechado — patrimônio materializado até aqui`, 'ok');
      await loadWizardDay(date);
    } catch (err) {
      appendLog(logEl, `❌ Fechar dia: ${err.message}`, 'err');
    } finally {
      btnWizardCloseDay.disabled = false;
    }
  });

  /* ─── Opção C ─── */
  const btnPickOptcNotas = container.querySelector('#btn-pick-optc-notas');
  const btnPickOptcExtratos = container.querySelector('#btn-pick-optc-extratos');
  const inputOptcNotas = container.querySelector('#input-path-optc-notas');
  const inputOptcExtratos = container.querySelector('#input-path-optc-extratos');
  const labelOptcNotas = container.querySelector('#label-optc-notas');
  const labelOptcExtratos = container.querySelector('#label-optc-extratos');
  const btnOptcStart = container.querySelector('#btn-optc-start');
  const btnOptcNextDay = container.querySelector('#btn-optc-next-day');
  const btnOptcRunAll = container.querySelector('#btn-optc-run-all');
  const btnOptcSeedAnchors = container.querySelector('#btn-optc-seed-anchors');
  const optcAnchorsStatus = container.querySelector('#optc-anchors-status');
  const optcStatus = container.querySelector('#optc-status');
  const optcPending = container.querySelector('#optc-pending');
  const optcProgress = container.querySelector('#optc-progress');
  const optcProgressLabel = container.querySelector('#optc-progress-label');
  const optcProgressBar = container.querySelector('#optc-progress-bar');
  const optcResetFirst = container.querySelector('#optc-reset-first');

  let optcNotesFiles = [];
  let optcExtractFiles = [];
  let optcRunId = null;
  let optcState = null;
  let optcSessionId = null;

  function refreshOptcStartButton() {
    const ready = optcNotesFiles.length > 0 && optcExtractFiles.length > 0;
    if (btnOptcStart) btnOptcStart.disabled = !ready;
  }

  function updateOptcProgress(state) {
    if (!state || !optcProgress) return;
    optcProgress.hidden = false;
    const total = state.phase === 'notes' ? state.calendar.length : state.extractFilesCount || 1;
    const done = state.phase === 'notes' ? state.dayIndex : state.phase === 'done' ? total : 0;
    const pct = total > 0 ? Math.round((100 * done) / total) : 0;
    if (optcProgressBar) optcProgressBar.style.width = `${pct}%`;
    if (optcProgressLabel) {
      optcProgressLabel.textContent = `Fase ${state.phase} · ${done}/${total} · horizonte ${state.horizonTrustedThrough || '—'}`;
    }
  }

  async function renderOptcPending(pending, sessionId, day) {
    if (!optcPending) return;
    optcPending.innerHTML = renderPendingDecisions(pending);
    optcPending.querySelectorAll('.wizard-resolve').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const decisionId = btn.getAttribute('data-decision-id');
        const action = btn.getAttribute('data-action');
        try {
          await apiRequest(
            `/api/invest/reconcile/session/${encodeURIComponent(sessionId)}/day/${encodeURIComponent(day)}/resolve`,
            { method: 'POST', body: { decisionId, action } }
          );
          appendLog(logEl, `✅ Opção C: pendência resolvida (${action})`, 'ok');
          optcPending.innerHTML = '<p class="muted">Pendência resolvida — clique em Fechamento do próximo dia.</p>';
        } catch (err) {
          appendLog(logEl, `❌ Opção C resolver: ${err.message}`, 'err');
        }
      });
    });
  }

  async function runOptcNextDay() {
    if (!optcRunId) return null;
    const data = await apiRequest('/api/invest/reconcile/option-c/next-day', {
      method: 'POST',
      body: { runId: optcRunId },
    });
    optcState = data.state;
    updateOptcProgress(optcState);
    for (const line of optcState?.activityLog?.slice(-5) || []) {
      appendLog(logEl, line);
    }
    if (data.status === 'blocked') {
      if (optcStatus) optcStatus.textContent = `⚠️ Bloqueado em ${data.day}`;
      await renderOptcPending(data.pendingDecisions || [], optcSessionId, data.day);
      return data;
    }
    if (optcPending) optcPending.innerHTML = '';
    if (data.status === 'closed' && data.day) {
      if (optcStatus) optcStatus.textContent = `✅ ${data.day} fechado`;
      appendLog(logEl, `✅ Opção C: ${data.day} fechado com cotações + patrimônio gravado.`, 'ok');
    }
    if (data.status === 'phase_complete') {
      appendLog(logEl, '─── Fase notas OK — importando extratos…', 'section');
    }
    if (data.status === 'done') {
      if (optcStatus) optcStatus.textContent = '🎉 Opção C concluída';
      appendLog(logEl, '🎉 Opção C concluída — confira Resultado histórico e Ações/FIIs.', 'ok');
      if (btnOptcNextDay) btnOptcNextDay.disabled = true;
      if (btnOptcRunAll) btnOptcRunAll.disabled = true;
    }
    return data;
  }

  btnPickOptcNotas?.addEventListener('click', async () => {
    try {
      const result = await pickPdfFilesFromFolder();
      optcNotesFiles = result.files;
      if (inputOptcNotas) inputOptcNotas.value = result.folderPath || 'Pasta selecionada';
      if (labelOptcNotas) labelOptcNotas.textContent = result.fileCountLabel;
      refreshOptcStartButton();
    } catch (err) {
      appendLog(logEl, `⚠️ Opção C notas: ${err.message}`, 'warn');
    }
  });

  btnPickOptcExtratos?.addEventListener('click', async () => {
    try {
      const result = await pickExtractFilesFromFolder();
      optcExtractFiles = result.files;
      if (inputOptcExtratos) inputOptcExtratos.value = result.folderPath || 'Pasta selecionada';
      if (labelOptcExtratos) labelOptcExtratos.textContent = result.fileCountLabel;
      refreshOptcStartButton();
    } catch (err) {
      appendLog(logEl, `⚠️ Opção C extratos: ${err.message}`, 'warn');
    }
  });

  function formatOptcAnchorsSummary(anchors) {
    const n = anchors?.month_ends?.length ?? 0;
    if (!n) return 'Nenhuma âncora gravada — clique em Carregar âncoras BTG';
    const last = [...anchors.month_ends].sort((a, b) => a.date.localeCompare(b.date)).pop();
    return `${n} ponto(s) — último ${last?.date ?? '?'}`;
  }

  async function refreshOptcAnchorsStatus() {
    try {
      const data = await apiRequest('/api/invest/reconcile/patrimony-anchors');
      if (optcAnchorsStatus) optcAnchorsStatus.textContent = formatOptcAnchorsSummary(data.anchors);
    } catch {
      if (optcAnchorsStatus) optcAnchorsStatus.textContent = 'Âncoras: indisponível';
    }
  }

  btnOptcSeedAnchors?.addEventListener('click', async () => {
    btnOptcSeedAnchors.disabled = true;
    if (optcAnchorsStatus) optcAnchorsStatus.textContent = 'Gravando âncoras BTG…';
    try {
      const data = await apiRequest('/api/invest/reconcile/patrimony-anchors/seed-btg', {
        method: 'POST',
        body: {},
      });
      if (optcAnchorsStatus) optcAnchorsStatus.textContent = formatOptcAnchorsSummary(data.anchors);
      appendLog(logEl, `✅ ${data.message}`, 'ok');
    } catch (err) {
      appendLog(logEl, `❌ Âncoras BTG: ${err.message}`, 'err');
      if (optcAnchorsStatus) optcAnchorsStatus.textContent = '❌ ' + err.message;
    } finally {
      btnOptcSeedAnchors.disabled = false;
    }
  });

  void refreshOptcAnchorsStatus();

  btnOptcStart?.addEventListener('click', async () => {
    if (!optcNotesFiles.length || !optcExtractFiles.length) return;
    btnOptcStart.disabled = true;
    if (optcStatus) optcStatus.textContent = 'Iniciando Opção C…';
    appendLog(logEl, '─── Opção C: reset + indexação + calendário ───', 'section');
    try {
      const data = await apiRequest('/api/invest/reconcile/option-c/start', {
        method: 'POST',
        body: {
          notesFiles: optcNotesFiles,
          extractFiles: optcExtractFiles,
          resetFirst: optcResetFirst?.checked === true,
        },
      });
      optcRunId = data.state.runId;
      optcState = data.state;
      optcSessionId = data.state.sessionId;
      updateOptcProgress(optcState);
      if (btnOptcNextDay) btnOptcNextDay.disabled = false;
      if (btnOptcRunAll) btnOptcRunAll.disabled = false;
      if (optcStatus) optcStatus.textContent = `Run ${optcRunId} — ${optcState.calendar.length} pregão(ões)`;
      if (data.anchorsSeeded) {
        appendLog(logEl, '✅ Âncoras BTG homebroker gravadas automaticamente (tabela vazia).', 'ok');
        await refreshOptcAnchorsStatus();
      }
      if (data.schemaApplied) {
        appendLog(
          logEl,
          '✅ Banco atualizado automaticamente (tabelas sessão de conciliação).',
          'ok'
        );
      }
      appendLog(logEl, `✅ Opção C iniciada: ${optcState.calendar.length} dia(s) de notas.`, 'ok');
      setStepState(container, 'reset', 'done', '✅ Via Opção C');
    } catch (err) {
      const msg = formatReconcileApiError(err);
      appendLog(logEl, `❌ Opção C: ${msg}`, 'err');
      if (optcStatus) optcStatus.textContent = `❌ ${err.message || msg}`;
      btnOptcStart.disabled = false;
    }
  });

  btnOptcNextDay?.addEventListener('click', async () => {
    btnOptcNextDay.disabled = true;
    try {
      await runOptcNextDay();
    } catch (err) {
      appendLog(logEl, `❌ Opção C next-day: ${err.message}`, 'err');
    } finally {
      if (optcState?.phase !== 'done') btnOptcNextDay.disabled = false;
    }
  });

  btnOptcRunAll?.addEventListener('click', async () => {
    btnOptcRunAll.disabled = true;
    btnOptcNextDay.disabled = true;
    appendLog(logEl, '─── Opção C: fechamento automático (calmo) ───', 'section');
    try {
      for (let guard = 0; guard < 5000; guard += 1) {
        const data = await runOptcNextDay();
        if (!data || data.status === 'done' || data.status === 'blocked') break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      appendLog(logEl, `❌ Opção C run-all: ${err.message}`, 'err');
    } finally {
      if (optcState?.phase !== 'done' && optcState?.phase !== 'extracts') {
        btnOptcNextDay.disabled = false;
      }
      if (optcState?.phase !== 'done') btnOptcRunAll.disabled = false;
    }
  });
}
