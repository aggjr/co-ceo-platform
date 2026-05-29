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

function formatOpeningDate(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
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
    notesFolderLabel: 'Nenhuma pasta selecionada',
    extractFiles: [],
    extractFolderLabel: 'Nenhuma pasta selecionada (após fase notas)',
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
  const workflowPanel = el('section', 'invest-conciliacao__workflow');
  workflowPanel.hidden = true;

  const statusEl = el('p', 'invest-conciliacao__status muted', '');
  const notesPathEl = el('span', 'invest-conciliacao__folder-path', state.notesFolderLabel);
  const extractPathEl = el('span', 'invest-conciliacao__folder-path', state.extractFolderLabel);
  const resetCheck = document.createElement('input');
  resetCheck.type = 'checkbox';
  resetCheck.id = 'conciliacao-reset-base';
  resetCheck.className = 'invest-conciliacao__checkbox';

  const pendingHost = el('div', 'invest-conciliacao__pending');
  const ledgerTable = el('table', 'invest-conciliacao__table');
  const fileTable = el('table', 'invest-conciliacao__table');
  const blockEl = el('p', 'invest-conciliacao__blocked', '');

  setupPanel.appendChild(el('h2', 'invest-conciliacao__setup-title', 'Configuração'));

  const notesRow = el('div', 'invest-conciliacao__folder-row');
  notesRow.appendChild(el('span', 'invest-conciliacao__folder-icon', '📁'));
  const notesBody = el('div', 'invest-conciliacao__folder-body');
  notesBody.appendChild(el('label', 'invest-conciliacao__folder-label', 'Notas de corretagem (PDF)'));
  notesBody.appendChild(notesPathEl);
  notesRow.appendChild(notesBody);
  notesRow.appendChild(
    btn('Escolher pasta', async () => {
      const { files, label } = await pickPdfFilesFromFolder();
      state.notesFiles = files;
      state.notesFolderLabel = files.length ? label : 'Nenhuma pasta selecionada';
      notesPathEl.textContent = state.notesFolderLabel;
    })
  );
  setupPanel.appendChild(notesRow);

  const extractRow = el('div', 'invest-conciliacao__folder-row');
  extractRow.appendChild(el('span', 'invest-conciliacao__folder-icon', '📁'));
  const extractBody = el('div', 'invest-conciliacao__folder-body');
  extractBody.appendChild(
    el('label', 'invest-conciliacao__folder-label', 'Extrato / financeiro (PDF, CSV ou TXT)')
  );
  extractBody.appendChild(extractPathEl);
  extractRow.appendChild(extractBody);
  extractRow.appendChild(
    btn('Escolher pasta', async () => {
      const { files, label } = await pickExtractFilesFromFolder();
      state.extractFiles = files;
      state.extractFolderLabel = files.length ? label : 'Nenhuma pasta selecionada';
      extractPathEl.textContent = state.extractFolderLabel;
    })
  );
  setupPanel.appendChild(extractRow);

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

  host.appendChild(setupPanel);
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
      statusEl.textContent = 'Zerando base…';
      startBtn.disabled = true;
      try {
        await apiRequest('/api/invest/reconcile/reset-holding', { method: 'POST', body: '{}' });
        statusEl.textContent = 'Base zerada. Iniciando sessão de notas…';
      } catch (e) {
        statusEl.textContent = e?.message || 'Falha ao zerar base.';
        startBtn.disabled = false;
        return;
      }
    } else if (state.preflight?.needsDataModeChoice) {
      const ok = window.confirm(
        'O livro já tem movimentações além da abertura.\n' +
          'Sem zerar, a conciliação tentará recuperar/corrigir em cima do que existe.\n\nContinuar em modo recuperar?'
      );
      if (!ok) return;
    }

    statusEl.textContent = 'Lendo notas e abrindo sessão…';
    startBtn.disabled = true;
    try {
      const res = await apiRequest('/api/invest/reconcile/session/start', {
        method: 'POST',
        body: JSON.stringify({
          phase: 'notes',
          files: state.notesFiles,
          dataMode: state.dataMode,
        }),
      });
      state.sessionId = res.sessionId;
      state.calendar = res.calendar || [];
      state.dayIndex = 0;
      workflowPanel.hidden = false;
      workflowPanel.replaceChildren();
      buildWorkflowUi();
      await loadDay();
      statusEl.textContent = `Sessão iniciada — ${state.calendar.length} dia(s) de pregão nas notas.`;
    } catch (e) {
      statusEl.textContent = e?.message || 'Falha ao iniciar sessão.';
      startBtn.disabled = false;
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
      { method: 'POST', body: JSON.stringify({ decisionId, action }) }
    );
    await loadDay();
  }

  async function closeDay() {
    const date = state.calendar[state.dayIndex];
    await apiRequest(
      `/api/invest/reconcile/session/${state.sessionId}/day/${date}/close`,
      { method: 'POST', body: '{}' }
    );
    if (state.dayIndex < state.calendar.length - 1) {
      state.dayIndex += 1;
      await loadDay();
      return;
    }
    await apiRequest(`/api/invest/reconcile/session/${state.sessionId}/complete-phase`, {
      method: 'POST',
      body: '{}',
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

  await renderShell(container, { title, content: host });
  await loadPreflight();
}
