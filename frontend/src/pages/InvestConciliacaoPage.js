import '../styles/invest-conciliacao.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { isAuthenticated } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { pickPdfFilesFromFolder } from '../lib/importFilePicker.js';
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
  const copy = {
    pendingTitle: 'Pendências do dia',
    noPending: 'Nenhuma pendência.',
    closeDay: 'Fechar dia',
    pickFolder: 'Pasta de notas (PDF)',
    viewChart: 'Resultado histórico',
    ledgerCol: 'Livro',
    fileCol: 'Notas',
    blockedHint: 'Resolva todas as pendências antes de fechar o dia.',
    notesComplete: 'Fase notas concluída.',
    modalTitle: 'Como deseja iniciar a conciliação?',
    modalRecover:
      'Recuperar — mantém o livro atual e concilia em cima dos dados existentes.',
    modalReset:
      'Refazer do zero — apaga movimentações, snapshots e sessões desta holding. Permanecem usuários, saldo inicial e posições de abertura.',
    modalResetBtn: 'Refazer do zero (só abertura)',
    modalRecoverBtn: 'Recuperar dados atuais',
    modalCancel: 'Cancelar',
    modalConfirmReset: 'Confirma apagar tudo exceto a abertura e recomeçar?',
    preflightLoading: 'Verificando dados da holding…',
    resetDone: 'Holding resetada. Escolha a pasta de notas.',
    pickFolderBlocked: 'Escolha primeiro recuperar ou refazer do zero.',
  };

  const host = el('div', 'invest-conciliacao');
  const state = {
    sessionId: null,
    calendar: [],
    dayIndex: 0,
    day: null,
    copy,
    dataMode: null,
    preflight: null,
    modeChosen: false,
  };

  const statusEl = el('p', 'invest-conciliacao__progress', copy.preflightLoading);
  const pendingHost = el('div', 'invest-conciliacao__pending');
  const ledgerTable = el('table', 'invest-conciliacao__table');
  const fileTable = el('table', 'invest-conciliacao__table');
  const blockEl = el('p', 'invest-conciliacao__blocked', '');
  const modeBanner = el('p', 'invest-conciliacao__mode-banner', '');

  const modalBackdrop = el('div', 'invest-conciliacao__modal-backdrop');
  modalBackdrop.hidden = true;
  const modal = el('div', 'invest-conciliacao__modal');
  const modalBody = el('div', 'invest-conciliacao__modal-body', '');
  modal.appendChild(el('h2', 'invest-conciliacao__modal-title', copy.modalTitle));
  modal.appendChild(modalBody);
  const modalActions = el('div', 'invest-conciliacao__modal-actions');
  modal.appendChild(modalActions);
  modalBackdrop.appendChild(modal);

  function setModeBanner() {
    if (!state.dataMode) {
      modeBanner.textContent = '';
      return;
    }
    const open = state.preflight?.openingDate;
    const openBr = formatOpeningDate(open);
    modeBanner.textContent =
      state.dataMode === 'reset_from_opening'
        ? `Modo: refazer do zero (abertura preservada em ${openBr}).`
        : 'Modo: recuperar livro existente.';
  }

  function closeModal() {
    modalBackdrop.hidden = true;
  }

  function showDataModeModal(preflight) {
    const pv = preflight.purgePreview;
    const openBr = formatOpeningDate(preflight.openingDate);
    modalBody.replaceChildren();
    modalBody.appendChild(
      el(
        'p',
        '',
        `A holding já tem movimentações além da abertura (${openBr}). Escolha uma opção:`
      )
    );
    if (pv) {
      const stats = el('ul', 'invest-conciliacao__modal-stats');
      stats.appendChild(
        el('li', '', `Pernas patrimoniais a remover: ${pv.patrimonyLegsToRemove}`)
      );
      stats.appendChild(
        el('li', '', `Pernas financeiras a remover: ${pv.financialLegsToRemove}`)
      );
      stats.appendChild(el('li', '', `Referência de abertura: ${pv.openingRef}`));
      modalBody.appendChild(stats);
    }
    modalBody.appendChild(el('p', '', copy.modalRecover));
    modalBody.appendChild(el('p', 'invest-conciliacao__modal-warn', copy.modalReset));

    modalActions.replaceChildren();
    modalActions.appendChild(
      btn(copy.modalRecoverBtn, () => {
        state.dataMode = 'recover';
        state.modeChosen = true;
        closeModal();
        setModeBanner();
        statusEl.textContent = 'Modo recuperar — escolha a pasta de notas.';
        pickBtn.disabled = false;
      })
    );
    modalActions.appendChild(
      btn(
        copy.modalResetBtn,
        async () => {
          if (!window.confirm(copy.modalConfirmReset)) return;
          closeModal();
          statusEl.textContent = 'Resetando holding (preservando abertura)…';
          pickBtn.disabled = true;
          try {
            await apiRequest('/api/invest/reconcile/reset-holding', {
              method: 'POST',
              body: '{}',
            });
            state.dataMode = 'reset_from_opening';
            state.modeChosen = true;
            setModeBanner();
            statusEl.textContent = copy.resetDone;
            pickBtn.disabled = false;
          } catch (e) {
            statusEl.textContent = e?.message || 'Falha ao resetar holding.';
            pickBtn.disabled = false;
            showDataModeModal(preflight);
          }
        },
        false,
        'btn btn-danger'
      )
    );
    modalActions.appendChild(btn(copy.modalCancel, closeModal));
    modalBackdrop.hidden = false;
  }

  async function loadPreflight() {
    try {
      const preflight = await apiRequest('/api/invest/reconcile/preflight');
      state.preflight = preflight;
      if (preflight.needsDataModeChoice) {
        showDataModeModal(preflight);
        statusEl.textContent = copy.pickFolderBlocked;
        pickBtn.disabled = true;
      } else {
        state.dataMode = 'recover';
        state.modeChosen = true;
        statusEl.textContent = 'Sem movimentações além da abertura — escolha a pasta de notas.';
        pickBtn.disabled = false;
      }
    } catch (e) {
      statusEl.textContent = e?.message || 'Falha no pré-voo.';
      pickBtn.disabled = true;
    }
  }

  async function loadDay() {
    if (!state.sessionId || !state.calendar.length) return;
    const date = state.calendar[state.dayIndex];
    const res = await apiRequest(
      `/api/invest/reconcile/session/${state.sessionId}/day/${date}`
    );
    state.day = res;
    statusEl.textContent =
      `Dia ${state.dayIndex + 1}/${state.calendar.length}: ${date}` +
      (res.horizonTrustedThrough ? ` | Horizonte: ${res.horizonTrustedThrough}` : '');
    renderPending(res.pendingDecisions || []);
    renderTables(res.preview?.rows || []);
    blockEl.textContent = res.canClose ? '' : state.copy.blockedHint;
    closeBtn.disabled = !res.canClose;
  }

  function renderPending(decisions) {
    pendingHost.replaceChildren();
    pendingHost.appendChild(el('h3', '', state.copy.pendingTitle));
    if (!decisions.length) {
      pendingHost.appendChild(el('p', '', state.copy.noPending));
      return;
    }
    for (const d of decisions) {
      const row = el('div', 'invest-conciliacao__pending-item');
      row.appendChild(el('span', '', `${d.kind} — ${d.decisionId}`));
      for (const action of d.allowedActions || []) {
        if (action === 'defer') continue;
        row.appendChild(btn(action, () => resolveDecision(d.decisionId, action)));
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

  async function startNotesSession() {
    if (!state.modeChosen || !state.dataMode) {
      if (state.preflight?.needsDataModeChoice) showDataModeModal(state.preflight);
      return;
    }
    const files = await pickPdfFilesFromFolder();
    if (!files.length) return;
    const res = await apiRequest('/api/invest/reconcile/session/start', {
      method: 'POST',
      body: JSON.stringify({
        phase: 'notes',
        files,
        dataMode: state.dataMode,
      }),
    });
    state.sessionId = res.sessionId;
    state.calendar = res.calendar || [];
    state.dayIndex = 0;
    await loadDay();
  }

  const closeBtn = btn(state.copy.closeDay, async () => {
    const date = state.calendar[state.dayIndex];
    await apiRequest(
      `/api/invest/reconcile/session/${state.sessionId}/day/${date}/close`,
      { method: 'POST', body: '{}' }
    );
    if (state.dayIndex < state.calendar.length - 1) {
      state.dayIndex += 1;
      await loadDay();
    } else {
      await apiRequest(`/api/invest/reconcile/session/${state.sessionId}/complete-phase`, {
        method: 'POST',
        body: '{}',
      });
      statusEl.textContent = state.copy.notesComplete;
    }
  }, true);

  const pickBtn = btn(state.copy.pickFolder, startNotesSession, true);
  const toolbar = el('div', 'invest-conciliacao__toolbar');
  toolbar.appendChild(pickBtn);
  toolbar.appendChild(
    btn('◀', async () => {
      if (state.dayIndex > 0) {
        state.dayIndex -= 1;
        await loadDay();
      }
    })
  );
  toolbar.appendChild(
    btn('▶', async () => {
      if (state.dayIndex < state.calendar.length - 1) {
        state.dayIndex += 1;
        await loadDay();
      }
    })
  );
  toolbar.appendChild(closeBtn);
  toolbar.appendChild(btn(state.copy.viewChart, () => navigate('/invest')));
  toolbar.appendChild(
    btn('Alterar modo', () => {
      if (state.preflight) showDataModeModal(state.preflight);
    })
  );

  host.appendChild(modalBackdrop);
  host.appendChild(toolbar);
  host.appendChild(modeBanner);
  host.appendChild(statusEl);
  host.appendChild(blockEl);
  host.appendChild(pendingHost);
  const tables = el('div', 'invest-conciliacao__tables');
  const lw = el('div', 'invest-conciliacao__table-wrap');
  lw.appendChild(el('h4', '', state.copy.ledgerCol));
  lw.appendChild(ledgerTable);
  const fw = el('div', 'invest-conciliacao__table-wrap');
  fw.appendChild(el('h4', '', state.copy.fileCol));
  fw.appendChild(fileTable);
  tables.appendChild(lw);
  tables.appendChild(fw);
  host.appendChild(tables);

  await renderShell(container, { title, content: host });
  await loadPreflight();
}
