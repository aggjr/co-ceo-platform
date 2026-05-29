import '../styles/invest-conciliacao.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { isAuthenticated } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import {
  pickPdfFilesFromFolder,
  pickExtractFilesFromFolder,
} from '../lib/importFilePicker.js';
import { navigate } from '../router.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function btn(label, onClick, disabled = false, className = 'btn btn-secondary') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/** Ícone de pasta clicável + título + campo de caminho + contagem abaixo. */
function buildFolderPickerRow(title, placeholder, onSelected) {
  const row = el('div', 'invest-conciliacao__folder-row');
  const folderBtn = document.createElement('button');
  folderBtn.type = 'button';
  folderBtn.className = 'invest-conciliacao__folder-picker';
  folderBtn.title = 'Escolher pasta';
  folderBtn.setAttribute('aria-label', `Escolher pasta — ${title}`);
  folderBtn.textContent = '📁';

  const body = el('div', 'invest-conciliacao__folder-body');
  body.appendChild(el('label', 'invest-conciliacao__folder-label', title));

  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.readOnly = true;
  pathInput.className = 'invest-conciliacao__folder-path-input';
  pathInput.placeholder = placeholder;
  pathInput.value = '';

  const countEl = el('span', 'invest-conciliacao__folder-count', 'Nenhum arquivo selecionado');

  const openPicker = async () => {
    const result = await onSelected();
    if (!result) return;
    pathInput.value = result.folderPath || '';
    countEl.textContent = result.fileCountLabel || 'Nenhum arquivo selecionado';
  };

  folderBtn.addEventListener('click', () => void openPicker());
  pathInput.addEventListener('click', () => void openPicker());

  body.appendChild(pathInput);
  body.appendChild(countEl);
  row.appendChild(folderBtn);
  row.appendChild(body);

  return {
    row,
    setSelection(folderPath, fileCountLabel) {
      pathInput.value = folderPath || '';
      countEl.textContent = fileCountLabel || 'Nenhum arquivo selecionado';
    },
  };
}

function formatOpeningDate(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fileDisplayName(path) {
  const p = String(path || '').replace(/\\/g, '/');
  const parts = p.split('/');
  return parts[parts.length - 1] || path;
}

function appendActivityLog(logEl, steps) {
  if (!logEl || !steps?.length) return;
  for (const s of steps) {
    const line = el('div', `invest-conciliacao__log-line invest-conciliacao__log-line--${s.level || 'info'}`);
    const cmd = s.command ? `[${s.command}] ` : '';
    line.textContent = `${s.at?.slice(11, 19) || ''} ${cmd}${s.message}`;
    logEl.appendChild(line);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(progressBar, progressLabel, percent, labelText) {
  if (progressBar) progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (progressLabel) progressLabel.textContent = labelText;
}

function renderFileStatusTable(tbody, files, pendingNames) {
  tbody.replaceChildren();
  const pendingSet = pendingNames ? new Set(pendingNames) : null;
  for (const f of files) {
    const tr = document.createElement('tr');
    const name = fileDisplayName(f.path || f.fileName);
    let status = 'PROCESSADO';
    let badgeClass = 'invest-conciliacao__status-badge--ok';
    if (pendingSet?.has(name) || pendingSet?.has(f.path)) {
      status = 'PROCESSANDO';
      badgeClass = 'invest-conciliacao__status-badge--pending';
    } else if (!f.parseOk) {
      status = 'ERRO';
      badgeClass = 'invest-conciliacao__status-badge--err';
    }
    const tdName = document.createElement('td');
    tdName.textContent = name;
    const tdDetail = document.createElement('td');
    tdDetail.textContent = f.parseOk
      ? `${f.notesCount ?? 0} nota(s) · ${f.ledgerLines ?? 0} linha(s)`
      : f.parseError || 'Falha na leitura';
    const tdStatus = document.createElement('td');
    const badge = el('span', `invest-conciliacao__status-badge ${badgeClass}`, status);
    tdStatus.appendChild(badge);
    tr.appendChild(tdName);
    tr.appendChild(tdDetail);
    tr.appendChild(tdStatus);
    tbody.appendChild(tr);
  }
}

export async function InvestConciliacaoPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const texts = await getPageTexts(
    ['screen.invest.conciliacao.title'],
    { 'screen.invest.conciliacao.title': 'Conciliação' }
  );
  const title = texts['screen.invest.conciliacao.title'];

  const state = {
    notesFiles: [],
    notesFolderPath: '',
    extractFiles: [],
    extractFolderPath: '',
    resetBase: false,
    dataMode: 'recover',
    preflight: null,
    sessionId: null,
    calendar: [],
    dayIndex: 0,
    notesPhaseDone: false,
  };

  const host = el('div', 'invest-conciliacao');
  const setupPanel = el('section', 'invest-conciliacao__setup');
  const importPanel = el('section', 'invest-conciliacao__import');
  importPanel.hidden = true;
  const workflowPanel = el('section', 'invest-conciliacao__workflow');
  workflowPanel.hidden = true;

  const progressLabel = el('p', 'invest-conciliacao__progress-label', '');
  const progressTrack = el('div', 'invest-conciliacao__progress-track');
  const progressBar = el('div', 'invest-conciliacao__progress-bar');
  progressTrack.appendChild(progressBar);
  const activityLogEl = el('div', 'invest-conciliacao__log');
  const filesTableBody = document.createElement('tbody');
  const filesTable = el('table', 'invest-conciliacao__table');
  const filesHead = document.createElement('thead');
  const headTr = document.createElement('tr');
  ['Arquivo', 'Detalhe', 'Status'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    headTr.appendChild(th);
  });
  filesHead.appendChild(headTr);
  filesTable.appendChild(filesHead);
  filesTable.appendChild(filesTableBody);
  const filesWrap = el('div', 'invest-conciliacao__files-table-wrap');
  filesWrap.appendChild(filesTable);

  const statusEl = el('p', 'invest-conciliacao__status muted', '');
  const resetCheck = document.createElement('input');
  resetCheck.type = 'checkbox';
  resetCheck.id = 'conciliacao-reset-base';
  resetCheck.className = 'invest-conciliacao__checkbox';

  const pendingHost = el('div', 'invest-conciliacao__pending');
  const ledgerTable = el('table', 'invest-conciliacao__table');
  const fileTable = el('table', 'invest-conciliacao__table');
  const blockEl = el('p', 'invest-conciliacao__blocked', '');

  setupPanel.appendChild(el('h2', 'invest-conciliacao__setup-title', 'Configuração'));

  const notesPicker = buildFolderPickerRow(
    'Notas de corretagem (PDF)',
    'Clique na pasta para escolher o diretório…',
    async () => {
      const result = await pickPdfFilesFromFolder();
      state.notesFiles = result.files;
      state.notesFolderPath = result.folderPath;
      return result;
    }
  );
  setupPanel.appendChild(notesPicker.row);

  const extractPicker = buildFolderPickerRow(
    'Extrato / financeiro (PDF, CSV ou TXT)',
    'Clique na pasta para escolher o diretório…',
    async () => {
      const result = await pickExtractFilesFromFolder();
      state.extractFiles = result.files;
      state.extractFolderPath = result.folderPath;
      return result;
    }
  );
  setupPanel.appendChild(extractPicker.row);

  const checkRow = el('label', 'invest-conciliacao__check-row');
  checkRow.htmlFor = 'conciliacao-reset-base';
  checkRow.appendChild(resetCheck);
  checkRow.appendChild(
    el(
      'span',
      '',
      'Zerar base e refazer todos os dados (mantém usuários e abertura do inventário inicial)'
    )
  );
  setupPanel.appendChild(checkRow);

  const startBtn = btn(
    'Iniciar conciliação',
    () => startConciliation(),
    false,
    'btn btn-primary invest-conciliacao__start-btn'
  );
  setupPanel.appendChild(startBtn);
  setupPanel.appendChild(statusEl);

  importPanel.appendChild(el('h2', 'invest-conciliacao__setup-title', 'Importação'));
  const progressWrap = el('div', 'invest-conciliacao__progress-wrap');
  progressWrap.appendChild(progressLabel);
  progressWrap.appendChild(progressTrack);
  importPanel.appendChild(progressWrap);
  importPanel.appendChild(el('h3', '', 'Comandos (também no log do servidor)'));
  importPanel.appendChild(activityLogEl);
  importPanel.appendChild(el('h3', '', 'Arquivos'));
  importPanel.appendChild(filesWrap);

  host.appendChild(setupPanel);
  host.appendChild(importPanel);
  host.appendChild(workflowPanel);

  async function loadPreflight() {
    try {
      state.preflight = await apiRequest('/api/invest/reconcile/preflight');
      const open = formatOpeningDate(state.preflight.openingDate);
      if (state.preflight.openingDate) {
        statusEl.textContent = `Abertura no livro: ${open}. ${
          state.preflight.needsDataModeChoice
            ? 'Marque o checkbox para zerar ou deixe desmarcado para recuperar o livro atual.'
            : 'Poucos dados além da abertura — pode iniciar sem zerar.'
        }`;
      }
    } catch (e) {
      statusEl.textContent = e?.message || 'Falha ao consultar estado da holding.';
    }
  }

  async function startConciliation() {
    if (!state.notesFiles.length) {
      statusEl.textContent = 'Selecione a pasta das notas de corretagem (PDF).';
      return;
    }

    state.resetBase = resetCheck.checked;
    state.dataMode = state.resetBase ? 'reset_from_opening' : 'recover';

    if (state.resetBase) {
      const open = formatOpeningDate(state.preflight?.openingDate);
      const msg =
        `Isso apaga movimentações, fechamentos e snapshots desta holding.\n` +
        `Permanecem usuários e a abertura (${open || 'data do livro'}).\n\nContinuar?`;
      if (!window.confirm(msg)) return;
    } else if (state.preflight?.needsDataModeChoice) {
      const ok = window.confirm(
        'O livro já tem movimentações além da abertura.\n' +
          'Sem zerar, a conciliação tentará recuperar/corrigir em cima do que existe.\n\nContinuar em modo recuperar?'
      );
      if (!ok) return;
    }

    importPanel.hidden = false;
    activityLogEl.replaceChildren();
    filesTableBody.replaceChildren();
    const pendingNames = state.notesFiles.map((f) => fileDisplayName(f.name));
    renderFileStatusTable(
      filesTableBody,
      pendingNames.map((name) => ({ path: name, parseOk: false })),
      pendingNames
    );

    startBtn.disabled = true;
    statusEl.textContent = '';
    try {
      if (state.resetBase) {
        setProgress(progressBar, progressLabel, 10, 'Zerando base da holding…');
        activityLogEl.appendChild(
          el('div', 'invest-conciliacao__log-line', 'POST /api/invest/reconcile/reset-holding')
        );
        const purge = await apiRequest('/api/invest/reconcile/reset-holding', {
          method: 'POST',
          body: {},
        });
        appendActivityLog(activityLogEl, purge.activityLog);
        setProgress(progressBar, progressLabel, 35, 'Base zerada — lendo PDFs…');
      } else {
        setProgress(progressBar, progressLabel, 15, 'Preparando leitura das notas…');
      }

      setProgress(progressBar, progressLabel, 45, 'Enviando notas e criando sessão…');
      activityLogEl.appendChild(
        el('div', 'invest-conciliacao__log-line', 'POST /api/invest/reconcile/session/start')
      );

      const res = await apiRequest('/api/invest/reconcile/session/start', {
        method: 'POST',
        body: {
          phase: 'notes',
          files: state.notesFiles,
          dataMode: state.resetBase ? 'recover' : state.dataMode,
        },
      });

      appendActivityLog(activityLogEl, res.activityLog);

      const fileResults = res.fileResults || [];
      const prog = res.importProgress || {};
      setProgress(
        progressBar,
        progressLabel,
        prog.percent ?? 100,
        `${prog.filesProcessed ?? fileResults.length}/${prog.filesTotal ?? state.notesFiles.length} arquivo(s) lidos`
      );
      renderFileStatusTable(filesTableBody, fileResults);

      state.sessionId = res.sessionId;
      state.calendar = res.calendar || [];
      state.dayIndex = 0;
      workflowPanel.hidden = false;
      workflowPanel.replaceChildren();
      buildWorkflowUi();
      await loadDay();
      statusEl.textContent = `Sessão iniciada — ${state.calendar.length} dia(s) de pregão nas notas.`;
      setProgress(progressBar, progressLabel, 100, 'Leitura concluída — concilie dia a dia abaixo');
    } catch (e) {
      const errLine = el('div', 'invest-conciliacao__log-line invest-conciliacao__log-line--error');
      errLine.textContent = e?.message || 'Falha na importação.';
      activityLogEl.appendChild(errLine);
      statusEl.textContent = e?.message || 'Falha ao iniciar sessão.';
      startBtn.disabled = false;
      setProgress(progressBar, progressLabel, 0, 'Erro — veja o log acima');
    }
  }

  function buildWorkflowUi() {
    workflowPanel.appendChild(el('h2', '', 'Conciliação — notas (dia a dia)'));

    const toolbar = el('div', 'invest-conciliacao__toolbar');
    const closeDayBtn = btn('Fechar dia', () => closeDay(), true);
    toolbar.appendChild(
      btn('◀', () => {
        if (state.dayIndex > 0) {
          state.dayIndex -= 1;
          loadDay();
        }
      })
    );
    toolbar.appendChild(
      btn('▶', () => {
        if (state.dayIndex < state.calendar.length - 1) {
          state.dayIndex += 1;
          loadDay();
        }
      })
    );
    toolbar.appendChild(closeDayBtn);
    toolbar.appendChild(btn('Resultado histórico', () => navigate('/invest')));
    workflowPanel.appendChild(toolbar);

    workflowPanel.appendChild(el('p', 'invest-conciliacao__progress', ''));
    workflowPanel.appendChild(blockEl);
    workflowPanel.appendChild(pendingHost);

    const tables = el('div', 'invest-conciliacao__tables');
    const lw = el('div', 'invest-conciliacao__table-wrap');
    lw.appendChild(el('h4', '', 'Livro'));
    lw.appendChild(ledgerTable);
    const fw = el('div', 'invest-conciliacao__table-wrap');
    fw.appendChild(el('h4', '', 'Notas'));
    fw.appendChild(fileTable);
    tables.appendChild(lw);
    tables.appendChild(fw);
    workflowPanel.appendChild(tables);
  }

  async function loadDay() {
    if (!state.sessionId || !state.calendar.length) return;
    const date = state.calendar[state.dayIndex];
    const res = await apiRequest(
      `/api/invest/reconcile/session/${state.sessionId}/day/${date}`
    );
    const progress = workflowPanel.querySelector('.invest-conciliacao__progress');
    if (progress) {
      progress.textContent = `Dia ${state.dayIndex + 1}/${state.calendar.length}: ${date}`;
    }
    renderPending(res.pendingDecisions || []);
    renderTables(res.preview?.rows || []);
    blockEl.textContent = res.canClose ? '' : 'Resolva todas as pendências antes de fechar o dia.';
    for (const b of workflowPanel.querySelectorAll('.invest-conciliacao__toolbar button')) {
      if (b.textContent === 'Fechar dia') b.disabled = !res.canClose;
    }
  }

  function renderPending(decisions) {
    pendingHost.replaceChildren();
    pendingHost.appendChild(el('h3', '', 'Pendências do dia'));
    if (!decisions.length) {
      pendingHost.appendChild(el('p', 'muted', 'Nenhuma pendência.'));
      return;
    }
    for (const d of decisions) {
      const row = el('div', 'invest-conciliacao__pending-item');
      row.appendChild(el('span', '', `${d.kind}`));
      for (const action of d.allowedActions || []) {
        if (action === 'defer') continue;
        row.appendChild(
          btn(action, () => resolveDecision(d.decisionId, action))
        );
      }
      pendingHost.appendChild(row);
    }
  }

  function renderTables(rows) {
    const ledgerRows = rows.filter((r) => r.source === 'ledger');
    const fileRows = rows.filter((r) => r.source === 'file');
    ledgerTable.replaceChildren(tableHead(), ...ledgerRows.map(tableRow));
    fileTable.replaceChildren(tableHead(), ...fileRows.map(tableRow));
  }

  function tableHead() {
    const tr = document.createElement('tr');
    ['Status', 'Ticker', 'Qtd', 'Preço'].forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c;
      tr.appendChild(th);
    });
    return tr;
  }

  function tableRow(r) {
    const tr = document.createElement('tr');
    if (r.status !== 'matched') tr.className = 'invest-conciliacao__row--highlight';
    [r.status, r.ticker, String(r.quantity), String(r.unitPrice)].forEach((c) => {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    });
    return tr;
  }

  async function resolveDecision(decisionId, action) {
    const date = state.calendar[state.dayIndex];
    await apiRequest(
      `/api/invest/reconcile/session/${state.sessionId}/day/${date}/resolve`,
      { method: 'POST', body: { decisionId, action } }
    );
    await loadDay();
  }

  async function closeDay() {
    const date = state.calendar[state.dayIndex];
    await apiRequest(
      `/api/invest/reconcile/session/${state.sessionId}/day/${date}/close`,
      { method: 'POST', body: {} }
    );
    if (state.dayIndex < state.calendar.length - 1) {
      state.dayIndex += 1;
      await loadDay();
      return;
    }
    await apiRequest(`/api/invest/reconcile/session/${state.sessionId}/complete-phase`, {
      method: 'POST',
      body: {},
    });
    state.notesPhaseDone = true;
    const progress = workflowPanel.querySelector('.invest-conciliacao__progress');
    if (progress) {
      progress.textContent =
        'Fase notas concluída. Selecionou extrato na configuração — fase extrato em breve nesta tela.';
    }
    if (state.extractFiles.length) {
      statusEl.textContent =
        'Notas concluídas. Próximo passo: conciliação do extrato (use a mesma tela após atualização).';
    }
  }

  await renderShell(container, {
    title: `INVEST — ${title}`,
    contentHtml: '<div id="invest-conciliacao-root"></div>',
  });
  const root = container.querySelector('#invest-conciliacao-root');
  (root || container).replaceChildren(host);
  await loadPreflight();
}
