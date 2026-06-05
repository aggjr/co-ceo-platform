import '../styles/invest-conciliacao.css';
import '../styles/invest-conciliacao-modal.css';
import '../styles/coceo-excel-table.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { mountCoCeoExcelGrid } from '../lib/coCeoExcelGrid.js';
import {
  pickPdfFilesFromFolder,
  pickExtractFilesFromFolder,
  pickHomeBrokerFilesFromFolder,
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
  const time = new Date().toLocaleTimeString('pt-BR');
  line.textContent = `[${time}] ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;

  const rows = JSON.parse(logEl.dataset.rows || '[]');
  rows.push({ id: `log-${rows.length + 1}`, time, type: type || 'info', message });
  logEl.dataset.rows = JSON.stringify(rows.slice(-500));
  const hostId = logEl.dataset.excelHost;
  const host = hostId ? document.getElementById(hostId) : null;
  if (host) {
    mountCoCeoExcelGrid(host, {
      gridId: 'invest-conciliacao-log-operacoes',
      rows,
      emptyText: 'Sem eventos no log.',
      summaryLabels: { total: 'Eventos', selected: '' },
      fixedLeadingColumns: 2,
      coCeoColumns: [
        { key: 'time', label: 'Hora', type: 'text', width: '110px', sticky: true },
        { key: 'type', label: 'Tipo', type: 'text', width: '110px', sticky: true },
        { key: 'message', label: 'Mensagem', type: 'text', width: '980px' },
      ],
    });
  }
}

function logOptcBrowser(level, event, detail = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...detail,
  };
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
  console[method]('[invest:reconcile:ui]', payload);
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
    const qtyLabel =
      d.kind === 'qty_custody_mismatch'
        ? `patrimônio ${String(ctx.patrimonyItemsQty ?? '—')} · livro ${String(ctx.ledgerQty ?? '—')}`
        : `qtd ${String(ctx.quantity ?? '—')} · R$ ${String(ctx.unitPrice ?? '—')}`;
    const actions = (d.allowedActions || [])
      .map((a) => `<button type="button" class="btn btn-sm btn-secondary wizard-resolve" data-decision-id="${escapeHtml(d.decisionId)}" data-action="${escapeHtml(a)}">${escapeHtml(RECON_ACTION_LABELS[a] || a)}</button>`)
      .join(' ');
    return `
      <div class="invest-conciliacao__pending-item" data-decision-id="${escapeHtml(d.decisionId)}">
        <strong>${escapeHtml(d.kind || d.summaryKey || 'pendência')}</strong>
        <span class="muted">${escapeHtml(ctx.ticker || '')} · ${escapeHtml(qtyLabel)}</span>
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
            <strong>Opção C</strong> agora é o caminho de homologação: limpa após a abertura, remonta dia a dia,
            grava patrimônio e registra divergências como avisos. O wizard manual fica para a conciliação rígida.
          </p>
        </div>
      </div>

      <!-- Opção C — fechamento calmo dia a dia (recomendado) -->
      <div class="conciliacao-action-panel invest-conciliacao__option-c" id="option-c-panel">
        <h2>Opção C — Homologação dia a dia (recomendado agora)</h2>
        <p class="muted">
          Reset → indique <strong>notas, extratos e opcionalmente fechamentos do home broker</strong> → o sistema fecha cada pregão com
          cotações brapi/opcoes.net, grava patrimônio diário, recalcula custódia e os 3 preços (zeram quando a posição zera).
          Divergências ficam no log para ajuste posterior; nesta fase o processo avança para ganhar tempo.
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
          <div class="conciliacao-import-panel">
            <h3>📊 Fechamentos home broker (JSON opcional)</h3>
            <div class="invest-conciliacao__folder-row" style="border:none;padding:0;margin-bottom:0.5rem">
              <button id="btn-pick-optc-homebroker" class="invest-conciliacao__folder-picker" title="Home broker">📂</button>
              <div class="invest-conciliacao__folder-body">
                <input id="input-path-optc-homebroker" class="invest-conciliacao__folder-path-input" placeholder="Pasta fechamentos home broker" readonly />
                <span id="label-optc-homebroker" class="invest-conciliacao__folder-count">Opcional: snapshots ou âncoras mensais JSON</span>
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
          <div class="invest-conciliacao__progress-label" id="optc-progress-label-extracts" style="margin-top: 1rem" hidden></div>
          <div class="invest-conciliacao__progress-track" id="optc-progress-track-extracts" hidden><div class="invest-conciliacao__progress-bar" id="optc-progress-bar-extracts"></div></div>
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
        <div id="conciliacao-log-table-host" class="portfolio-excel-section"></div>
        <div id="conciliacao-log" class="conciliacao-log" hidden></div>
      </div>

    </div>
  `;

  await renderShell(container, { title: 'INVEST — Conciliação', contentHtml: content });

  /*
   * Visual atual de homologação:
   * Os fluxos antigos continuam no template por enquanto, mas ficam ocultos via CSS:
   * wizard manual, reset isolado, importação isolada, recálculo isolado e botões auxiliares.
   * Este bloco injeta apenas os painéis que serão usados agora.
   */
  container.querySelector('#option-c-panel')?.insertAdjacentHTML('afterend', `
    <div class="conciliacao-action-panel conciliacao-results-panel">
      <div class="conciliacao-panel-heading">
        <div>
          <p class="conciliacao-kicker">Conferência</p>
          <h2>Notas analisadas</h2>
        </div>
      </div>
      <div id="optc-notes-analysis" class="conciliacao-notes-list">
        <p class="muted">Selecione a pasta de notas para montar a lista.</p>
      </div>
    </div>

    <div class="conciliacao-action-panel conciliacao-results-panel">
      <div class="conciliacao-panel-heading">
        <div>
          <p class="conciliacao-kicker">Tabela tipo Excel</p>
          <h2>Arquivos lidos no processo</h2>
        </div>
        <span id="optc-files-summary" class="conciliacao-state-badge conciliacao-state-badge--idle">Nenhum arquivo selecionado</span>
      </div>
      <div class="conciliacao-excel-wrap">
        <div id="optc-files-table-host" class="portfolio-excel-section"></div>
        <!-- Tabela manual antiga substituída pelo ExcelTable oficial CO-CEO. -->
        <table class="conciliacao-excel-table" hidden>
          <thead>
            <tr>
              <th>#</th>
              <th>Tipo</th>
              <th>Arquivo</th>
              <th>Resultado</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody id="optc-files-table-body">
            <tr><td colspan="5" class="muted">Aguardando seleção das pastas.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="conciliacao-action-panel conciliacao-results-panel">
      <div class="conciliacao-panel-heading">
        <div>
          <p class="conciliacao-kicker">Batimento individual</p>
          <h2>Conferir carteira, eventos e caixa</h2>
        </div>
        <button id="btn-load-diagnostics" class="btn btn-primary" type="button">Conferir agora</button>
      </div>
      <p class="muted">
        Use esta conferência antes de confiar no gráfico: ela cruza livro, posição atual, snapshot do home broker,
        3 preços, eventos de negócio e saldo em transição.
      </p>
      <div id="diagnostics-summary" class="conciliacao-status-text"></div>
      <div class="conciliacao-daily-ledgers" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:1rem;align-items:start;">
        <div id="diagnostics-daily-financial-host" class="portfolio-excel-section"></div>
        <div id="diagnostics-daily-business-host" class="portfolio-excel-section"></div>
        <div id="diagnostics-daily-portfolio-host" class="portfolio-excel-section"></div>
      </div>
      <div id="diagnostics-critical-host" class="portfolio-excel-section"></div>
      <div id="diagnostics-assets-host" class="portfolio-excel-section"></div>
      <div id="diagnostics-events-host" class="portfolio-excel-section"></div>
      <div id="diagnostics-cash-host" class="portfolio-excel-section"></div>
    </div>
  `);
  container.querySelector('#option-c-panel h2')?.insertAdjacentHTML('afterend', `
    <div class="conciliacao-stage-strip" aria-label="Etapas da homologação">
      <div class="conciliacao-stage conciliacao-stage--active" data-optc-stage="files">
        <span>1</span><strong>Arquivos</strong><small>notas e extratos</small>
      </div>
      <div class="conciliacao-stage" data-optc-stage="start">
        <span>2</span><strong>Preparação</strong><small>reset e indexação</small>
      </div>
      <div class="conciliacao-stage" data-optc-stage="run">
        <span>3</span><strong>Remontagem</strong><small>dia a dia</small>
      </div>
      <div class="conciliacao-stage" data-optc-stage="done">
        <span>4</span><strong>Resultado</strong><small>finalizado ou parado</small>
      </div>
    </div>
  `);

  /* ─── DOM refs ─── */
  const logEl = container.querySelector('#conciliacao-log');
  if (logEl) {
    logEl.dataset.excelHost = 'conciliacao-log-table-host';
    appendLog(logEl, 'Aguardando início do processamento.', 'info');
  }
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
          const preflight = await apiRequest('/api/invest/reconcile/preflight');
          if (!preflight.openingDate) {
            throw new Error(
              'Nenhuma abertura (opening_balance) no livro. Importe o inventário inicial antes do reset.'
            );
          }
          appendLog(
            logEl,
            `Abertura detectada: ${preflight.openingDate} (${preflight.openingLegCount ?? 0} perna(s))`
          );

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
            for (const step of report.activityLog || []) {
              const msg =
                typeof step === 'string'
                  ? step
                  : `[${step.command || 'log'}] ${step.message || ''}`;
              appendLog(logEl, `  ${msg}`, step.level === 'error' ? 'err' : step.level === 'ok' ? 'ok' : '');
            }
            setStepState(container, 'reset', 'done', '✅ Concluído');
            if (resetStatus) resetStatus.textContent = '✅ Base limpa. Importe as NOTAS (Passo 2).';

            enableStep2();

          } else {
            throw new Error(data.error || 'Falha no reset.');
          }
        } catch (err) {
          const msg = formatReconcileApiError(err);
          appendLog(logEl, `❌ Erro no reset: ${msg}`, 'err');
          setStepState(container, 'reset', 'error', '❌ Falha no reset');
          if (resetStatus) resetStatus.textContent = '❌ ' + msg;
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
      const msg = formatReconcileApiError(err);
      appendLog(logEl, `❌ Erro nas notas: ${msg}`, 'err');
      setStepState(container, 'import-notas', 'error', '❌ Falha nas notas');
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
      const msg = formatReconcileApiError(err);
      appendLog(logEl, `❌ Erro nos extratos: ${msg}`, 'err');
      setStepState(container, 'import-extratos', 'error', '❌ Falha nos extratos');
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
  const btnPickOptcHomeBroker = container.querySelector('#btn-pick-optc-homebroker');
  const inputOptcNotas = container.querySelector('#input-path-optc-notas');
  const inputOptcExtratos = container.querySelector('#input-path-optc-extratos');
  const inputOptcHomeBroker = container.querySelector('#input-path-optc-homebroker');
  const labelOptcNotas = container.querySelector('#label-optc-notas');
  const labelOptcExtratos = container.querySelector('#label-optc-extratos');
  const labelOptcHomeBroker = container.querySelector('#label-optc-homebroker');
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
  const optcFilesTableHost = container.querySelector('#optc-files-table-host');
  const optcFilesTableBody = container.querySelector('#optc-files-table-body');
  const optcFilesSummary = container.querySelector('#optc-files-summary');
  const optcNotesAnalysis = container.querySelector('#optc-notes-analysis');
  const optcProcessState = document.createElement('span');
  const btnLoadDiagnostics = container.querySelector('#btn-load-diagnostics');
  const diagnosticsSummary = container.querySelector('#diagnostics-summary');
  const diagnosticsDailyFinancialHost = container.querySelector('#diagnostics-daily-financial-host');
  const diagnosticsDailyBusinessHost = container.querySelector('#diagnostics-daily-business-host');
  const diagnosticsDailyPortfolioHost = container.querySelector('#diagnostics-daily-portfolio-host');
  const diagnosticsCriticalHost = container.querySelector('#diagnostics-critical-host');
  const diagnosticsAssetsHost = container.querySelector('#diagnostics-assets-host');
  const diagnosticsEventsHost = container.querySelector('#diagnostics-events-host');
  const diagnosticsCashHost = container.querySelector('#diagnostics-cash-host');

  let optcNotesFiles = [];
  let optcExtractFiles = [];
  let optcHomeBrokerFiles = [];
  let optcRunId = null;
  let optcState = null;
  let optcSessionId = null;
  let optcFileRows = [];
  const OPTC_LAST_RUN_STORAGE_KEY = 'invest:conciliacao:option-c:last-run:v1';

  const heroTitle = container.querySelector('.conciliacao-hero__title');
  const heroSubtitle = container.querySelector('.conciliacao-hero__subtitle');
  const optionTitle = container.querySelector('#option-c-panel h2');
  if (heroTitle) heroTitle.textContent = 'Conciliação INVEST';
  if (heroSubtitle) {
    heroSubtitle.textContent =
      'Fluxo de homologação: selecione as pastas, prepare a base e processe tudo. A tela mostra progresso, notas analisadas e arquivos lidos.';
  }
  if (optionTitle) optionTitle.textContent = 'Remontar carteira e patrimônio';

  [
    [btnPickOptcNotas, 'Selecionar notas'],
    [btnPickOptcExtratos, 'Selecionar extratos'],
    [btnPickOptcHomeBroker, 'Selecionar fechamentos'],
  ].forEach(([button, label]) => {
    if (!button) return;
    button.textContent = label;
    button.className = 'btn btn-file';
  });
  if (btnOptcStart) btnOptcStart.textContent = '1. Preparar homologação';
  if (btnOptcStart) btnOptcStart.classList.add('btn-xl');
  if (btnOptcStart) btnOptcStart.hidden = true;
  if (btnOptcNextDay) btnOptcNextDay.hidden = true;
  if (btnOptcRunAll) {
    btnOptcRunAll.textContent = 'Processar conciliação';
    btnOptcRunAll.classList.add('btn-xl', 'btn-xl--success');
  }
  if (optcStatus) {
    optcStatus.classList.add('conciliacao-status-text');
    optcStatus.textContent = 'Selecione notas e extratos para começar.';
    optcStatus.parentElement?.prepend(optcProcessState);
  }
  optcProcessState.id = 'optc-process-state';
  optcProcessState.className = 'conciliacao-state-badge conciliacao-state-badge--idle';
  optcProcessState.textContent = 'Aguardando arquivos';

  function fileDisplayName(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .pop() || String(path || 'arquivo');
  }

  function setProcessState(label, tone = 'idle') {
    optcProcessState.className = `conciliacao-state-badge conciliacao-state-badge--${tone}`;
    optcProcessState.textContent = label;
  }

  function setStage(stage) {
    container.querySelectorAll('[data-optc-stage]').forEach((el) => {
      el.classList.toggle('conciliacao-stage--active', el.getAttribute('data-optc-stage') === stage);
      el.classList.toggle('conciliacao-stage--done', false);
    });
    const order = ['files', 'start', 'run', 'done'];
    const index = order.indexOf(stage);
    order.slice(0, Math.max(index, 0)).forEach((doneStage) => {
      container
        .querySelector(`[data-optc-stage="${doneStage}"]`)
        ?.classList.add('conciliacao-stage--done');
    });
  }

  function upsertFileRows(kind, files, status, detail) {
    optcFileRows = optcFileRows.filter((row) => row.kind !== kind);
    optcFileRows.push(
      ...files.map((file, index) => ({
        id: `${kind}-${index}-${file.name}`,
        kind,
        name: fileDisplayName(file.name),
        status,
        detail,
      }))
    );
    renderOptcFileTables();
    saveOptcLastRun();
  }

  function setFileRowsStatus(kind, status, detail) {
    optcFileRows = optcFileRows.map((row) =>
      row.kind === kind ? { ...row, status, detail } : row
    );
    renderOptcFileTables();
    saveOptcLastRun();
  }

  function statusTone(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('erro') || s.includes('parou')) return 'err';
    if (s.includes('final') || s.includes('analis') || s.includes('lido') || s.includes('import')) return 'ok';
    return 'pending';
  }

  function diagnosticTone(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('error') || s.includes('missing')) return 'err';
    if (s.includes('warn')) return 'pending';
    return 'ok';
  }

  function renderStatusCell(row) {
    const span = document.createElement('span');
    span.className = `import-status import-status--${diagnosticTone(row.status)}`;
    span.textContent = row.status || '';
    return span;
  }

  function mountDiagnostics(report) {
    const summary = report.summary || {};
    const snap = report.snapshot;
    if (diagnosticsSummary) {
      diagnosticsSummary.textContent =
        `Data ${report.asOf || '-'} · snapshot ${snap?.referenceDate || 'não encontrado'} · ` +
        `${summary.criticalFindings || 0} achado(s) crítico(s), ` +
        `${summary.assetErrors || 0} ativo(s), ${summary.eventErrors || 0} evento(s), ` +
        `${summary.cashErrors || 0} financeiro(s) com erro.`;
    }

    mountCoCeoExcelGrid(diagnosticsDailyFinancialHost, {
      caption: '1. Planilha financeira por dia',
      gridId: 'invest-conciliacao-diario-financeiro',
      rows: report.dailyAudit?.financial || [],
      emptyText: 'Sem trilha financeira diária.',
      summaryLabels: { total: 'Dias', selected: '' },
      fixedLeadingColumns: 1,
      coCeoColumns: [
        { key: 'date', label: 'Dia', type: 'text', width: '120px', sticky: true },
        { key: 'openingCash', label: 'Caixa inicial', type: 'currency', width: '135px' },
        { key: 'openingTransit', label: 'Trânsito inicial', type: 'currency', width: '145px' },
        { key: 'assetMovementValue', label: 'Mov. ativos', type: 'currency', width: '135px' },
        { key: 'pureFinancialValue', label: 'Financeiro puro', type: 'currency', width: '145px' },
        { key: 'transitChange', label: 'Var. trânsito', type: 'currency', width: '135px' },
        { key: 'closingTransit', label: 'Trânsito final', type: 'currency', width: '145px' },
        { key: 'closingCash', label: 'Caixa final', type: 'currency', width: '135px' },
        { key: 'closingCashWithTransit', label: 'Caixa + trânsito', type: 'currency', width: '155px' },
        { key: 'assetDetails', label: 'Detalhe ligado a ativos', type: 'text', width: '520px' },
        { key: 'pureFinancialDetails', label: 'Detalhe financeiro puro', type: 'text', width: '520px' },
        { key: 'transitDetails', label: 'Detalhe trânsito', type: 'text', width: '520px' },
      ],
    });

    mountCoCeoExcelGrid(diagnosticsDailyBusinessHost, {
      caption: '2. Operações de negócio por dia',
      gridId: 'invest-conciliacao-diario-negocio',
      rows: report.dailyAudit?.business || [],
      emptyText: 'Sem operações de negócio diárias.',
      summaryLabels: { total: 'Dias', selected: '' },
      fixedLeadingColumns: 2,
      coCeoColumns: [
        { key: 'date', label: 'Dia', type: 'text', width: '120px', sticky: true },
        { key: 'status', label: 'Status', type: 'text', width: '110px', sticky: true, render: renderStatusCell },
        { key: 'businessEvents', label: 'Eventos', type: 'number', width: '105px' },
        { key: 'bothSidesEvents', label: '2 lados', type: 'number', width: '105px' },
        { key: 'financialOnlyEvents', label: 'Só financeiro', type: 'number', width: '130px' },
        { key: 'assetOnlyEvents', label: 'Só ativos', type: 'number', width: '115px' },
        { key: 'missingBusinessEventCount', label: 'Sem evento', type: 'number', width: '120px' },
        { key: 'linkedAssetExpectedCash', label: 'Caixa esperado ativos', type: 'currency', width: '165px' },
        { key: 'linkedFinancialCash', label: 'Caixa ligado', type: 'currency', width: '140px' },
        { key: 'eventCashDelta', label: 'Delta evento', type: 'currency', width: '140px' },
        { key: 'businessExplanation', label: 'Explicações de negócio', type: 'text', width: '680px' },
        { key: 'unlinkedExplanation', label: 'Sem explicação', type: 'text', width: '620px' },
      ],
    });

    mountCoCeoExcelGrid(diagnosticsDailyPortfolioHost, {
      caption: '3. Planilha de ativos por dia',
      gridId: 'invest-conciliacao-diario-ativos',
      rows: report.dailyAudit?.portfolio || [],
      emptyText: 'Sem trilha diária de ativos.',
      summaryLabels: { total: 'Dias', selected: '' },
      fixedLeadingColumns: 1,
      coCeoColumns: [
        { key: 'date', label: 'Dia', type: 'text', width: '120px', sticky: true },
        { key: 'openingPortfolioValue', label: 'Carteira inicial', type: 'currency', width: '150px' },
        { key: 'assetMovementDelta', label: 'Alteração carteira', type: 'currency', width: '165px' },
        { key: 'closingPortfolioValue', label: 'Carteira final', type: 'currency', width: '150px' },
        { key: 'totalPatrimonyFromSheets', label: 'Patrimônio calculado', type: 'currency', width: '175px' },
        { key: 'changedAssets', label: 'Alterações no dia', type: 'text', width: '620px' },
        { key: 'consideredAssets', label: 'Carteira final considerada', type: 'text', width: '760px' },
      ],
    });

    mountCoCeoExcelGrid(diagnosticsCriticalHost, {
      caption: 'Achados críticos',
      gridId: 'invest-conciliacao-diagnostico-critico',
      rows: report.critical || [],
      emptyText: 'Nenhum achado crítico encontrado.',
      summaryLabels: { total: 'Achados', selected: '' },
      fixedLeadingColumns: 2,
      coCeoColumns: [
        { key: 'area', label: 'Área', type: 'text', width: '140px', sticky: true },
        { key: 'severity', label: 'Severidade', type: 'text', width: '130px', sticky: true },
        { key: 'finding', label: 'Achado', type: 'text', width: '980px' },
      ],
    });

    mountCoCeoExcelGrid(diagnosticsAssetsHost, {
      caption: 'Ativos: livro × posição atual × home broker × 3 preços',
      gridId: 'invest-conciliacao-diagnostico-ativos',
      rows: report.assets || [],
      emptyText: 'Sem ativos para conferir.',
      summaryLabels: { total: 'Ativos', selected: '' },
      fixedLeadingColumns: 3,
      coCeoColumns: [
        { key: 'status', label: 'Status', type: 'text', width: '110px', sticky: true, render: renderStatusCell },
        { key: 'ticker', label: 'Ticker', type: 'text', width: '110px', sticky: true },
        { key: 'assetType', label: 'Tipo', type: 'text', width: '130px', sticky: true },
        { key: 'ledgerQty', label: 'Qtd livro', type: 'number', width: '120px' },
        { key: 'storedQty', label: 'Qtd tela', type: 'number', width: '120px' },
        { key: 'brokerMarkQty', label: 'Qtd broker', type: 'number', width: '120px' },
        { key: 'brokerPendingQty', label: 'Qtd pendente broker', type: 'number', width: '160px' },
        { key: 'qtyDelta', label: 'Delta qtd', type: 'number', width: '120px' },
        { key: 'pmEstrito', label: 'PM estrito', type: 'currency', width: '130px' },
        { key: 'pmB3', label: 'PM B3', type: 'currency', width: '120px' },
        { key: 'pmGerencial', label: 'Meu PM', type: 'currency', width: '120px' },
        { key: 'brokerAvgPrice', label: 'PM broker', type: 'currency', width: '130px' },
        { key: 'avgPriceDelta', label: 'Delta PM', type: 'number', width: '120px' },
        { key: 'lastPrice', label: 'Cotação', type: 'currency', width: '120px' },
        { key: 'finding', label: 'Diagnóstico', type: 'text', width: '620px' },
      ],
    });

    mountCoCeoExcelGrid(diagnosticsEventsHost, {
      caption: 'Eventos de negócio: elo entre ativo e financeiro',
      gridId: 'invest-conciliacao-diagnostico-eventos',
      rows: report.businessEvents || [],
      emptyText: 'Sem eventos para conferir.',
      summaryLabels: { total: 'Eventos', selected: '' },
      fixedLeadingColumns: 3,
      coCeoColumns: [
        { key: 'status', label: 'Status', type: 'text', width: '110px', sticky: true, render: renderStatusCell },
        { key: 'date', label: 'Data', type: 'text', width: '120px', sticky: true },
        { key: 'tickers', label: 'Ativos', type: 'text', width: '230px', sticky: true },
        { key: 'patrimonyLegs', label: 'Pernas ativo', type: 'number', width: '130px' },
        { key: 'cashLegs', label: 'Pernas caixa', type: 'number', width: '130px' },
        { key: 'tradeCash', label: 'Valor ativo', type: 'currency', width: '140px' },
        { key: 'clearedCash', label: 'Caixa liquidado', type: 'currency', width: '150px' },
        { key: 'pendingCash', label: 'Caixa trânsito', type: 'currency', width: '150px' },
        { key: 'openPending', label: 'Trânsito aberto', type: 'currency', width: '150px' },
        { key: 'finding', label: 'Diagnóstico', type: 'text', width: '650px' },
      ],
    });

    mountCoCeoExcelGrid(diagnosticsCashHost, {
      caption: 'Financeiro e renda fixa',
      gridId: 'invest-conciliacao-diagnostico-caixa',
      rows: report.cash || [],
      emptyText: 'Sem dados financeiros.',
      summaryLabels: { total: 'Linhas', selected: '' },
      fixedLeadingColumns: 2,
      coCeoColumns: [
        { key: 'status', label: 'Status', type: 'text', width: '110px', sticky: true, render: renderStatusCell },
        { key: 'item', label: 'Item', type: 'text', width: '220px', sticky: true },
        { key: 'systemValue', label: 'Sistema', type: 'currency', width: '150px' },
        { key: 'brokerValue', label: 'Broker', type: 'currency', width: '150px' },
        { key: 'delta', label: 'Delta', type: 'currency', width: '150px' },
        { key: 'finding', label: 'Diagnóstico', type: 'text', width: '720px' },
      ],
    });
  }

  function renderOptcFileTables() {
    if (optcFilesTableHost) {
      const rows = optcFileRows.map((row, index) => ({
        id: row.id,
        index: index + 1,
        kind: row.kind,
        name: row.name,
        status: row.status,
        detail: row.detail || '',
        tone: statusTone(row.status),
      }));
      mountCoCeoExcelGrid(optcFilesTableHost, {
        gridId: 'invest-conciliacao-arquivos-lidos',
        rows,
        emptyText: 'Aguardando seleção das pastas.',
        summaryLabels: { total: 'Arquivos', selected: '' },
        fixedLeadingColumns: 2,
        coCeoColumns: [
          { key: 'index', label: '#', type: 'number', align: 'right', width: '72px', sticky: true },
          { key: 'kind', label: 'Tipo', type: 'text', width: '140px', sticky: true },
          { key: 'name', label: 'Arquivo', type: 'text', width: '520px' },
          {
            key: 'status',
            label: 'Resultado',
            type: 'text',
            width: '170px',
            render: (row) => {
              const span = document.createElement('span');
              span.className = `import-status import-status--${row.tone}`;
              span.textContent = row.status || '';
              return span;
            },
          },
          { key: 'detail', label: 'Detalhe', type: 'text', width: '520px' },
        ],
      });
    }
    if (optcFilesTableBody) {
      if (!optcFileRows.length) {
        optcFilesTableBody.innerHTML =
          '<tr><td colspan="5" class="muted">Aguardando seleção das pastas.</td></tr>';
      } else {
        optcFilesTableBody.innerHTML = optcFileRows
          .map((row, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(row.kind)}</td>
              <td>${escapeHtml(row.name)}</td>
              <td><span class="import-status import-status--${statusTone(row.status)}">${escapeHtml(row.status)}</span></td>
              <td>${escapeHtml(row.detail || '')}</td>
            </tr>
          `)
          .join('');
      }
    }

    if (optcFilesSummary) {
      const total = optcFileRows.length;
      const ok = optcFileRows.filter((row) => statusTone(row.status) === 'ok').length;
      const err = optcFileRows.filter((row) => statusTone(row.status) === 'err').length;
      optcFilesSummary.className = `conciliacao-state-badge conciliacao-state-badge--${err ? 'err' : ok === total && total ? 'ok' : 'idle'}`;
      optcFilesSummary.textContent = total
        ? `${ok}/${total} concluído(s)${err ? `, ${err} com erro` : ''}`
        : 'Nenhum arquivo selecionado';
    }

    if (optcNotesAnalysis) {
      const noteRows = optcFileRows.filter((row) => row.kind === 'Nota');
      mountCoCeoExcelGrid(optcNotesAnalysis, {
        gridId: 'invest-conciliacao-notas-analisadas',
        rows: noteRows.map((row, index) => ({
          id: row.id,
          index: index + 1,
          name: row.name,
          status: row.status,
          detail: row.detail || '',
          tone: statusTone(row.status),
        })),
        emptyText: 'Selecione a pasta de notas para montar a lista.',
        summaryLabels: { total: 'Notas', selected: '' },
        fixedLeadingColumns: 2,
        coCeoColumns: [
          { key: 'index', label: '#', type: 'number', align: 'right', width: '72px', sticky: true },
          { key: 'name', label: 'Nota', type: 'text', width: '560px', sticky: true },
          {
            key: 'status',
            label: 'Resultado',
            type: 'text',
            width: '160px',
            render: (row) => {
              const span = document.createElement('span');
              span.className = `import-status import-status--${row.tone}`;
              span.textContent = row.status || '';
              return span;
            },
          },
          { key: 'detail', label: 'Detalhe', type: 'text', width: '520px' },
        ],
      });
    }
  }

  renderOptcFileTables();

  function readOptcLogRows() {
    try {
      const rows = JSON.parse(logEl?.dataset?.rows || '[]');
      return Array.isArray(rows) ? rows.slice(-500) : [];
    } catch {
      return [];
    }
  }

  function saveOptcLastRun() {
    if (!optcRunId && !optcState && !optcFileRows.length) return;
    try {
      const state = optcState
        ? {
            ...optcState,
            activityLog: Array.isArray(optcState.activityLog)
              ? optcState.activityLog.slice(-500)
              : [],
          }
        : null;
      localStorage.setItem(
        OPTC_LAST_RUN_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          runId: optcRunId,
          state,
          sessionId: optcSessionId,
          fileRows: optcFileRows.slice(-1000),
          activityLogCount: optcActivityLogCount,
          statusText: optcStatus?.textContent || '',
          processStateText: optcProcessState.textContent || '',
          processStateClass: optcProcessState.className || '',
          logRows: readOptcLogRows(),
        })
      );
    } catch {
      // localStorage pode estar cheio ou indisponivel; a conciliacao continua no servidor.
    }
  }

  function restoreOptcLogRows(rows) {
    if (!logEl || !Array.isArray(rows) || !rows.length) return;
    logEl.innerHTML = '';
    logEl.dataset.rows = '[]';
    for (const row of rows.slice(-500)) {
      appendLog(logEl, row.message || '', row.type || '');
    }
  }

  function stageFromOptcState(state) {
    if (!state) return 'files';
    if (state.phase === 'done' || state.runStatus === 'done') return 'done';
    if (state.phase === 'notes' || state.phase === 'extracts' || state.runStatus === 'running') return 'run';
    return state.runId ? 'start' : 'files';
  }

  function applyRestoredOptcState(saved) {
    if (!saved || typeof saved !== 'object') return false;
    optcRunId = saved.runId || saved.state?.runId || null;
    optcState = saved.state || null;
    optcSessionId = saved.sessionId || saved.state?.sessionId || null;
    optcFileRows = Array.isArray(saved.fileRows) ? saved.fileRows : [];
    optcActivityLogCount = Number(saved.activityLogCount || optcState?.activityLog?.length || 0);
    renderOptcFileTables();
    if (optcState) updateOptcProgress(optcState);
    setStage(stageFromOptcState(optcState));
    if (saved.processStateText) {
      optcProcessState.textContent = saved.processStateText;
      if (saved.processStateClass) optcProcessState.className = saved.processStateClass;
    } else if (optcState?.runStatus === 'error') {
      setProcessState('Parou com erro', 'err');
    } else if (optcState?.phase === 'done' || optcState?.runStatus === 'done') {
      setProcessState('Finalizado', 'ok');
    } else if (optcRunId) {
      setProcessState('Processando', 'idle');
    }
    if (optcStatus && saved.statusText) optcStatus.textContent = saved.statusText;
    restoreOptcLogRows(saved.logRows);
    if (btnOptcStart) btnOptcStart.disabled = true;
    if (btnOptcNextDay) btnOptcNextDay.disabled = true;
    if (btnOptcRunAll) btnOptcRunAll.disabled = true;
    return Boolean(optcRunId || optcState || optcFileRows.length);
  }

  function refreshOptcStartButton() {
    const ready = optcNotesFiles.length > 0 && optcExtractFiles.length > 0;
    if (btnOptcStart) btnOptcStart.disabled = !ready;
    if (btnOptcRunAll) btnOptcRunAll.disabled = !ready;
    if (ready && !optcRunId) {
      setProcessState('Pronto para preparar', 'ok');
      if (optcStatus) optcStatus.textContent = 'Arquivos mínimos selecionados. Clique em Processar conciliação.';
    }
  }

  function updateOptcProgress(state) {
    if (!state || !optcProgress) return;
    optcProgress.hidden = false;
    
    // Fase 1: Notas
    const notesTotal = state.calendar.length || 1;
    const notesDone = state.phase === 'notes' ? state.dayIndex : notesTotal;
    const notesPct = Math.round((100 * notesDone) / notesTotal);
    
    if (optcProgressBar) optcProgressBar.style.width = `${notesPct}%`;
    if (optcProgressLabel) {
      optcProgressLabel.textContent = `Fase notas · ${notesDone}/${notesTotal} pregões analisados`;
    }

    // Fase 2: Extratos
    const labelExtracts = container.querySelector('#optc-progress-label-extracts');
    const trackExtracts = container.querySelector('#optc-progress-track-extracts');
    const barExtracts = container.querySelector('#optc-progress-bar-extracts');

    if (state.phase === 'extracts' || state.phase === 'done') {
      if (labelExtracts) labelExtracts.hidden = false;
      if (trackExtracts) trackExtracts.hidden = false;
      
      const extractsTotal = state.extractFilesCount || 1;
      
      if (barExtracts) {
        if (state.phase === 'extracts') {
          barExtracts.classList.add('invest-conciliacao__progress-bar--animated');
          barExtracts.style.width = '100%';
        } else {
          barExtracts.classList.remove('invest-conciliacao__progress-bar--animated');
          barExtracts.style.width = '100%';
        }
      }
      
      if (labelExtracts) {
        labelExtracts.textContent = state.phase === 'done' 
          ? `Fase extratos/materialização · Concluído`
          : `Fase extratos/materialização · Processando ${extractsTotal} arquivo(s) (pode levar alguns segundos)...`;
      }
    } else {
      if (labelExtracts) labelExtracts.hidden = true;
      if (trackExtracts) trackExtracts.hidden = true;
    }
  }

  async function refreshOptcDayPending(day) {
    if (!optcSessionId || !day) return;
    const data = await apiRequest(
      `/api/invest/reconcile/session/${encodeURIComponent(optcSessionId)}/day/${encodeURIComponent(day)}`
    );
    await renderOptcPending(data.pendingDecisions || [], optcSessionId, day);
    if (!(data.pendingDecisions || []).length && optcStatus) {
      optcStatus.textContent = `✅ ${day} — sem pendências, pode fechar`;
    }
    return data;
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
          await refreshOptcDayPending(day);
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
    logOptcBrowser('info', 'option-c.next-day.response', {
      runId: optcRunId,
      status: data.status,
      phase: optcState?.phase,
      day: data.day || null,
      dayIndex: optcState?.dayIndex,
      calendarDays: optcState?.calendar?.length,
    });
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
      const pendingCount = (data.pendingDecisions || []).length;
      if (optcStatus) {
        optcStatus.textContent = pendingCount
          ? `✅ ${data.day} materializado (${pendingCount} aviso(s))`
          : `✅ ${data.day} materializado`;
      }
      appendLog(logEl, `✅ Opção C: ${data.day} fechado com cotações + patrimônio gravado.`, 'ok');
      if (pendingCount) {
        appendLog(logEl, `⚠️ Homologação: ${pendingCount} pendência(s) registrada(s) no dia ${data.day}.`, 'warn');
      }
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

  let optcActivityLogCount = 0;

  async function pollOptcRunUntilDone() {
    if (!optcRunId) return;
    let transientErrors = 0;
    for (let guard = 0; guard < 720; guard += 1) {
      let data;
      try {
        data = await apiRequest(`/api/invest/reconcile/option-c/status/${encodeURIComponent(optcRunId)}`);
        transientErrors = 0;
      } catch (err) {
        transientErrors += 1;
        const msg = err?.message || String(err);
        appendLog(
          logEl,
          `⚠️ Status temporariamente indisponível (${transientErrors}/12): ${msg}`,
          'warn'
        );
        logOptcBrowser('warn', 'option-c.status.transient-error', {
          runId: optcRunId,
          transientErrors,
          message: msg,
        });
        if (transientErrors >= 12) throw err;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      optcState = data.state;
      updateOptcProgress(optcState);
      const lines = optcState?.activityLog || [];
      for (const line of lines.slice(optcActivityLogCount)) {
        appendLog(logEl, line);
      }
      optcActivityLogCount = lines.length;
      if (optcStatus) {
        let statusMsg = `Run ${optcRunId} — fase ${optcState.phase}`;
        if (optcState.phase === 'notes') statusMsg += ` — ${optcState.dayIndex}/${optcState.calendar.length}`;
        optcStatus.textContent = statusMsg;
      }
      saveOptcLastRun();
      if (optcState.runStatus === 'error') {
        throw new Error(optcState.runError || 'Processamento em segundo plano parou com erro.');
      }
      if (optcState.phase === 'done' || optcState.runStatus === 'done') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error('Tempo limite acompanhando processamento em segundo plano.');
  }

  async function refreshRestoredOptcRun() {
    if (!optcRunId) return;
    try {
      const data = await apiRequest(`/api/invest/reconcile/option-c/status/${encodeURIComponent(optcRunId)}`);
      optcState = data.state;
      optcSessionId = optcState?.sessionId || optcSessionId;
      updateOptcProgress(optcState);
      const lines = optcState?.activityLog || [];
      for (const line of lines.slice(optcActivityLogCount)) {
        appendLog(logEl, line);
      }
      optcActivityLogCount = lines.length;
      if (optcStatus && optcState) {
        optcStatus.textContent = `Run ${optcRunId} — fase ${optcState.phase}`;
      }
      saveOptcLastRun();
      if (
        optcState &&
        optcState.runStatus !== 'done' &&
        optcState.runStatus !== 'error' &&
        optcState.phase !== 'done'
      ) {
        await pollOptcRunUntilDone();
        if (optcState?.phase === 'done' || optcState?.runStatus === 'done') {
          setStage('done');
          setProcessState('Finalizado', 'ok');
          if (optcStatus) optcStatus.textContent = `Run ${optcRunId} finalizado.`;
          saveOptcLastRun();
        }
      }
    } catch (err) {
      appendLog(logEl, `⚠️ Não foi possível atualizar a última conciliação: ${err.message}`, 'warn');
      saveOptcLastRun();
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(OPTC_LAST_RUN_STORAGE_KEY) || 'null');
    if (applyRestoredOptcState(saved)) {
      void refreshRestoredOptcRun();
    }
  } catch {
    // Estado antigo inválido: ignora e deixa a tela pronta para uma nova conciliação.
  }

  btnPickOptcNotas?.addEventListener('click', async () => {
    try {
      const result = await pickPdfFilesFromFolder();
      optcNotesFiles = result.files;
      logOptcBrowser('info', 'files.notes.selected', {
        count: optcNotesFiles.length,
        folderPath: result.folderPath || null,
        fileNames: optcNotesFiles.map((file) => fileDisplayName(file.name)),
      });
      if (inputOptcNotas) inputOptcNotas.value = result.folderPath || 'Pasta selecionada';
      if (labelOptcNotas) labelOptcNotas.textContent = result.fileCountLabel;
      upsertFileRows('Nota', optcNotesFiles, 'Aguardando análise', 'Será analisada ao preparar a homologação.');
      setStage('files');
      refreshOptcStartButton();
    } catch (err) {
      appendLog(logEl, `⚠️ Opção C notas: ${err.message}`, 'warn');
    }
  });

  btnPickOptcExtratos?.addEventListener('click', async () => {
    try {
      const result = await pickExtractFilesFromFolder();
      optcExtractFiles = result.files;
      logOptcBrowser('info', 'files.extracts.selected', {
        count: optcExtractFiles.length,
        folderPath: result.folderPath || null,
        fileNames: optcExtractFiles.map((file) => fileDisplayName(file.name)),
      });
      if (inputOptcExtratos) inputOptcExtratos.value = result.folderPath || 'Pasta selecionada';
      if (labelOptcExtratos) labelOptcExtratos.textContent = result.fileCountLabel;
      upsertFileRows('Extrato', optcExtractFiles, 'Aguardando leitura', 'Será importado na fase financeira.');
      setStage('files');
      refreshOptcStartButton();
    } catch (err) {
      appendLog(logEl, `⚠️ Opção C extratos: ${err.message}`, 'warn');
    }
  });

  btnPickOptcHomeBroker?.addEventListener('click', async () => {
    try {
      const result = await pickHomeBrokerFilesFromFolder();
      optcHomeBrokerFiles = result.files;
      logOptcBrowser('info', 'files.homebroker.selected', {
        count: optcHomeBrokerFiles.length,
        folderPath: result.folderPath || null,
        fileNames: optcHomeBrokerFiles.map((file) => fileDisplayName(file.name)),
      });
      if (inputOptcHomeBroker) inputOptcHomeBroker.value = result.folderPath || 'Pasta selecionada';
      if (labelOptcHomeBroker) labelOptcHomeBroker.textContent = result.fileCountLabel;
      upsertFileRows('Home broker', optcHomeBrokerFiles, 'Aguardando leitura', 'Opcional para âncoras e snapshots.');
      appendLog(logEl, `📊 Home broker: ${optcHomeBrokerFiles.length} arquivo(s) JSON selecionado(s).`, 'ok');
    } catch (err) {
      appendLog(logEl, `⚠️ Opção C home broker: ${err.message}`, 'warn');
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

  async function loadDiagnostics() {
    if (btnLoadDiagnostics) btnLoadDiagnostics.disabled = true;
    if (diagnosticsSummary) diagnosticsSummary.textContent = 'Conferindo carteira, eventos e caixa...';
    try {
      const data = await apiRequest('/api/invest/reconcile/diagnostics');
      mountDiagnostics(data);
      appendLog(
        logEl,
        `Conferência individual: ${data.summary?.criticalFindings || 0} achado(s) crítico(s).`,
        (data.summary?.criticalFindings || 0) ? 'warn' : 'ok'
      );
    } catch (err) {
      if (diagnosticsSummary) diagnosticsSummary.textContent = `Erro na conferência: ${err.message}`;
      appendLog(logEl, `Conferência individual: ${err.message}`, 'err');
    } finally {
      if (btnLoadDiagnostics) btnLoadDiagnostics.disabled = false;
    }
  }

  btnLoadDiagnostics?.addEventListener('click', () => {
    void loadDiagnostics();
  });

  btnOptcStart?.addEventListener('click', async () => {
    if (!optcNotesFiles.length || !optcExtractFiles.length) return;
    logOptcBrowser('info', 'option-c.start.request', {
      notesFiles: optcNotesFiles.length,
      extractFiles: optcExtractFiles.length,
      homeBrokerFiles: optcHomeBrokerFiles.length,
      resetFirst: optcResetFirst?.checked === true,
    });
    btnOptcStart.disabled = true;
    setStage('start');
    setProcessState('Preparando', 'idle');
    setFileRowsStatus('Nota', 'Analisando', 'Indexando notas e calendário.');
    setFileRowsStatus('Extrato', 'Aguardando', 'Será lido após as notas.');
    setFileRowsStatus('Home broker', 'Lendo', 'Aplicando snapshots ou âncoras, se houver.');
    if (optcStatus) optcStatus.textContent = 'Iniciando homologação…';
    appendLog(logEl, '─── Opção C: reset + home broker + indexação + calendário ───', 'section');
    try {
      const data = await apiRequest('/api/invest/reconcile/option-c/start', {
        method: 'POST',
        body: {
          notesFiles: optcNotesFiles,
          extractFiles: optcExtractFiles,
          homeBrokerFiles: optcHomeBrokerFiles,
          resetFirst: optcResetFirst?.checked === true,
          mode: 'homologation',
        },
      });
      optcRunId = data.state.runId;
      optcState = data.state;
      optcSessionId = data.state.sessionId;
      logOptcBrowser('info', 'option-c.start.response', {
        runId: optcRunId,
        sessionId: optcSessionId,
        calendarDays: optcState.calendar.length,
        phase: optcState.phase,
        homeBrokerWarnings: optcState.homeBrokerImport?.warnings?.length ?? 0,
      });
      updateOptcProgress(optcState);
      if (btnOptcNextDay) btnOptcNextDay.disabled = false;
      if (btnOptcRunAll) btnOptcRunAll.disabled = false;
      setFileRowsStatus('Nota', 'Analisada', `${optcState.calendar.length} pregão(ões) encontrado(s).`);
      setFileRowsStatus('Extrato', 'Aguardando importação', 'Clique em Processar tudo para importar.');
      setFileRowsStatus(
        'Home broker',
        optcHomeBrokerFiles.length ? 'Lido' : 'Não enviado',
        optcHomeBrokerFiles.length ? 'Arquivo opcional processado.' : 'Sem arquivos opcionais.'
      );
      setProcessState('Pronto para processar', 'ok');
      if (optcStatus) optcStatus.textContent = `Run ${optcRunId} — ${optcState.calendar.length} pregão(ões)`;
      if (data.anchorsSeeded) {
        appendLog(logEl, '✅ Âncoras BTG homebroker gravadas automaticamente (tabela vazia).', 'ok');
        await refreshOptcAnchorsStatus();
      }
      const hb = optcState.homeBrokerImport;
      if (hb?.filesTotal) {
        appendLog(
          logEl,
          `✅ Home broker: ${hb.snapshotsImported} snapshot(s), ${hb.snapshotsApplied} aplicado(s), ${hb.anchorsUpserted} âncora(s).`,
          'ok'
        );
        for (const warning of hb.warnings || []) {
          appendLog(logEl, `⚠️ Home broker: ${warning}`, 'warn');
        }
        await refreshOptcAnchorsStatus();
      }
      if (data.schemaApplied) {
        appendLog(
          logEl,
          '✅ Banco atualizado automaticamente (tabelas sessão de conciliação).',
          'ok'
        );
      }
      appendLog(logEl, `✅ Homologação iniciada: ${optcState.calendar.length} dia(s) de notas.`, 'ok');
      setStepState(container, 'reset', 'done', '✅ Via Opção C');
      saveOptcLastRun();
    } catch (err) {
      const msg = formatReconcileApiError(err);
      setProcessState('Parou na preparação', 'err');
      setFileRowsStatus('Nota', 'Erro na análise', msg);
      appendLog(logEl, `❌ Opção C: ${msg}`, 'err');
      if (optcStatus) optcStatus.textContent = `❌ ${err.message || msg}`;
      saveOptcLastRun();
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
    if (btnOptcNextDay) btnOptcNextDay.disabled = true;
    logOptcBrowser('info', 'option-c.run-all.start', {
      runId: optcRunId,
      phase: optcState?.phase,
      dayIndex: optcState?.dayIndex,
      calendarDays: optcState?.calendar?.length,
    });
    setStage('run');
    setProcessState('Processando', 'idle');
    setFileRowsStatus('Extrato', 'Importando', 'Lendo financeiro e conciliando liquidações.');
    appendLog(logEl, '─── Opção C: fechamento automático (calmo) ───', 'section');
    try {
      const serverRun = await apiRequest('/api/invest/reconcile/option-c/run-all', {
        method: 'POST',
        body: {
          notesFiles: optcNotesFiles,
          extractFiles: optcExtractFiles,
          homeBrokerFiles: optcHomeBrokerFiles,
          resetFirst: optcResetFirst?.checked === true,
          mode: 'homologation',
          delayMs: 0,
          async: true,
        },
      });
      optcState = serverRun.state;
      optcRunId = optcState?.runId || optcRunId;
      optcSessionId = optcState?.sessionId || optcSessionId;
      optcActivityLogCount = optcState?.activityLog?.length || 0;
      updateOptcProgress(optcState);
      appendLog(logEl, `Processamento em segundo plano iniciado: ${optcRunId}`, 'ok');
      saveOptcLastRun();
      await pollOptcRunUntilDone();
      setStage('done');
      if (optcState?.phase === 'done') {
        setProcessState('Finalizado', 'ok');
        setFileRowsStatus('Extrato', 'Lido/importado', 'Processo finalizado.');
        setFileRowsStatus('Nota', 'Analisada', 'Processo finalizado.');
        setFileRowsStatus(
          'Home broker',
          optcHomeBrokerFiles.length ? 'Lido' : 'NÃ£o enviado',
          optcHomeBrokerFiles.length ? 'Arquivo opcional processado.' : 'Sem arquivos opcionais.'
        );
        if (optcStatus) optcStatus.textContent = `Run ${optcRunId} finalizado.`;
        appendLog(logEl, 'âœ… OpÃ§Ã£o C run-all concluÃ­da no servidor.', 'ok');
        logOptcBrowser('info', 'option-c.run-all.done', {
          runId: optcRunId,
          phase: optcState?.phase,
          dayIndex: optcState?.dayIndex,
        });
        await loadDiagnostics();
        saveOptcLastRun();
      } else {
        setProcessState('Parou', 'err');
        setFileRowsStatus('Extrato', 'Parou', serverRun.message || 'Processo pausado no servidor.');
        appendLog(logEl, `âš ï¸ OpÃ§Ã£o C pausada: ${serverRun.message || 'verifique o log da API.'}`, 'warn');
        logOptcBrowser('warn', 'option-c.run-all.blocked', {
          runId: optcRunId,
          phase: optcState?.phase,
          dayIndex: optcState?.dayIndex,
          message: serverRun.message || null,
        });
        saveOptcLastRun();
      }
      return;
      for (let guard = 0; guard < 5000; guard += 1) {
        const data = await runOptcNextDay();
        if (!data || data.status === 'done') {
          setStage('done');
          setProcessState('Finalizado', 'ok');
          setFileRowsStatus('Extrato', 'Lido/importado', 'Processo finalizado.');
          setFileRowsStatus('Nota', 'Analisada', 'Processo finalizado.');
          logOptcBrowser('info', 'option-c.run-all.done', {
            runId: optcRunId,
            phase: optcState?.phase,
            dayIndex: optcState?.dayIndex,
          });
          break;
        }
        if (data.status === 'blocked') {
          setStage('done');
          setProcessState('Parou', 'err');
          setFileRowsStatus('Extrato', 'Parou', `Parada operacional em ${data.day || '?'}.`);
          logOptcBrowser('warn', 'option-c.run-all.blocked', {
            runId: optcRunId,
            day: data.day || null,
            phase: optcState?.phase,
          });
          appendLog(logEl, `⚠️ Parada operacional em ${data.day || '?'}: verifique o log da API.`, 'warn');
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      setStage('done');
      setProcessState('Parou com erro', 'err');
      setFileRowsStatus('Extrato', 'Erro', err.message);
      logOptcBrowser('error', 'option-c.run-all.error', {
        runId: optcRunId,
        message: err.message,
        apiError: err?.body?.errorDetail || null,
      });
      appendLog(logEl, `❌ Opção C run-all: ${err.message}`, 'err');
      saveOptcLastRun();
    } finally {
      if (optcState?.phase !== 'done' && optcState?.phase !== 'extracts') {
        btnOptcNextDay.disabled = false;
      }
      if (optcState?.phase !== 'done') btnOptcRunAll.disabled = false;
    }
  });
}
