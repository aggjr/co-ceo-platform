import '../styles/invest-importacao.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';
import { bindImportFilePicker } from '../lib/importFilePicker.js';

const TEXT_FALLBACKS = {
  'screen.invest.importacao_mes.title': 'Importar mês BTG',
  'screen.invest.importacao_mes.lead':
    'Indique o mês, o extrato financeiro e a pasta de notas. O sistema analisa os dois mundos juntos e mostra se financeiro, notas e o batimento do mês estão OK antes de gravar.',
  'label.invest.importacao_mes.month': 'Mês',
  'label.invest.importacao_mes.extract': 'Extrato do mês (PDF ou CSV)',
  'label.invest.importacao_mes.notes_dir': 'Pasta de notas (filtra PDFs do mês)',
  'action.invest.importacao.pick_file': 'Escolher arquivo',
  'action.invest.importacao.pick_folder': 'Escolher pasta',
  'column.invest.importacao_mes.financial': 'Financeiro OK',
  'column.invest.importacao_mes.notes': 'Notas corretagem OK',
  'column.invest.importacao_mes.result': 'Resultado OK',
  'action.invest.importacao.preview': 'Analisar mês',
  'action.invest.importacao.apply': 'Importar mês no livro',
};

function statusBadge(ok) {
  if (ok === true) {
    return '<span class="import-status import-status--ok">OK</span>';
  }
  if (ok === false) {
    return '<span class="import-status import-status--err">Não</span>';
  }
  return '<span class="import-status import-status--muted">—</span>';
}

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
            resolve({ name: file.webkitRelativePath || file.name, contentBase64: base64 });
          };
          reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
          reader.readAsDataURL(file);
        })
    )
  );
}

function renderMonthResult(preview, t) {
  if (!preview) {
    return '<p class="muted">Selecione mês, extrato e pasta de notas, depois clique em Analisar mês.</p>';
  }
  return `
    <table class="import-status-table import-status-table--month">
      <thead>
        <tr>
          <th>Mês</th>
          <th>${t['column.invest.importacao_mes.financial']}</th>
          <th>${t['column.invest.importacao_mes.notes']}</th>
          <th>${t['column.invest.importacao_mes.result']}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${escapeHtml(preview.month)}</strong></td>
          <td>${statusBadge(preview.financialOk)}</td>
          <td>${statusBadge(preview.notesOk)}</td>
          <td>${statusBadge(preview.resultOk)}</td>
        </tr>
      </tbody>
    </table>
    <dl class="import-month-details">
      <dt>Financeiro</dt>
      <dd>${escapeHtml(preview.financialDetail)}</dd>
      <dt>Notas</dt>
      <dd>${escapeHtml(preview.notesDetail)} (${preview.notesFilesInMonth ?? 0} PDF(s) do mês em ${preview.notesFilesInFolder ?? 0} na pasta)</dd>
      <dt>Resultado</dt>
      <dd>${escapeHtml(preview.resultDetail)}</dd>
    </dl>
  `;
}

export async function InvestImportacaoMesPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(Object.keys(TEXT_FALLBACKS), TEXT_FALLBACKS);
  const title = t['screen.invest.importacao_mes.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${title}`,
      contentHtml:
        '<div class="card"><p class="muted">Personifique o titular da holding para importar por mês.</p></div>',
    });
    return;
  }

  const content = `
    <p class="muted" style="margin-bottom:1rem">${t['screen.invest.importacao_mes.lead']}</p>
    <p class="muted" style="margin-bottom:1rem">
      <a href="/invest/importacao">Importação avançada (lotes)</a>
    </p>
    <div class="card invest-import-card">
      <div class="invest-import-drop">
        <label class="import-field-label" for="import-mes-month">${t['label.invest.importacao_mes.month']}</label>
        <input type="month" id="import-mes-month" value="2026-01" />

        <div class="import-picker">
          <span class="import-field-label">${t['label.invest.importacao_mes.extract']}</span>
          <div class="import-picker-row">
            <input type="file" id="import-mes-extract" class="import-picker-input" accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain" />
            <button type="button" class="import-picker-btn" id="import-mes-extract-btn" aria-controls="import-mes-extract">
              <span class="import-picker-icon" aria-hidden="true">📂</span>
              <span>${t['action.invest.importacao.pick_file']}</span>
            </button>
            <span class="import-picker-name" id="import-mes-extract-label">Nenhum arquivo selecionado</span>
          </div>
        </div>

        <div class="import-picker">
          <span class="import-field-label">${t['label.invest.importacao_mes.notes_dir']}</span>
          <div class="import-picker-row">
            <input type="file" id="import-mes-notes-dir" class="import-picker-input" webkitdirectory directory multiple />
            <button type="button" class="import-picker-btn" id="import-mes-notes-btn" aria-controls="import-mes-notes-dir">
              <span class="import-picker-icon" aria-hidden="true">📂</span>
              <span>${t['action.invest.importacao.pick_folder']}</span>
            </button>
            <span class="import-picker-name" id="import-mes-notes-label">Nenhuma pasta selecionada</span>
          </div>
        </div>

        <p id="import-mes-summary" class="import-path-value muted" style="margin-top:0.75rem">—</p>
      </div>
      <div class="invest-import-actions">
        <button type="button" class="btn btn-import-analyze" id="import-mes-preview">${t['action.invest.importacao.preview']}</button>
        <button type="button" class="btn btn-primary" id="import-mes-apply">${t['action.invest.importacao.apply']}</button>
      </div>
      <div id="import-mes-result" class="import-table-host"></div>
    </div>
  `;

  await renderShell(container, { title: `INVEST — ${title}`, contentHtml: content });

  const monthInput = container.querySelector('#import-mes-month');
  const extractInput = container.querySelector('#import-mes-extract');
  const notesDir = container.querySelector('#import-mes-notes-dir');
  const summary = container.querySelector('#import-mes-summary');
  const resultHost = container.querySelector('#import-mes-result');
  const previewBtn = container.querySelector('#import-mes-preview');
  const applyBtn = container.querySelector('#import-mes-apply');

  const updateSummary = () => {
    if (!summary) return;
    const month = monthInput?.value || '—';
    const ex = extractInput?.files?.[0];
    const notes = notesDir?.files ? [...notesDir.files] : [];
    const exName = ex ? ex.name : '—';
    summary.textContent = `${month} · extrato: ${exName} · ${notes.length} arquivo(s) na pasta de notas`;
  };

  bindImportFilePicker(container, {
    inputSelector: '#import-mes-extract',
    buttonSelector: '#import-mes-extract-btn',
    labelSelector: '#import-mes-extract-label',
    emptyLabel: 'Nenhum arquivo selecionado',
    onChange: updateSummary,
  });

  bindImportFilePicker(container, {
    inputSelector: '#import-mes-notes-dir',
    buttonSelector: '#import-mes-notes-btn',
    labelSelector: '#import-mes-notes-label',
    emptyLabel: 'Nenhuma pasta selecionada',
    onChange: updateSummary,
  });

  monthInput?.addEventListener('change', updateSummary);

  const gatherPayload = async () => {
    const month = monthInput?.value || '';
    const extractFiles = extractInput?.files;
    if (!extractFiles?.length) {
      throw new Error('Selecione o extrato do mês.');
    }
    const noteList = notesDir?.files ? [...notesDir.files] : [];
    if (!noteList.length) {
      throw new Error('Selecione a pasta com as notas de corretagem.');
    }
    const [extractFile] = await readFilesAsPayload(extractFiles);
    const noteFiles = await readFilesAsPayload(noteList);
    return { month, extractFile, noteFiles, noteCount: noteList.length };
  };

  const run = async (dryRun) => {
    previewBtn.disabled = true;
    applyBtn.disabled = true;
    if (resultHost) {
      resultHost.innerHTML = '<p class="muted">Analisando mês...</p>';
    }
    try {
      const { month, extractFile, noteFiles, noteCount } = await gatherPayload();
      updateSummary();
      const data = await apiRequest('/api/invest/import/btg-month', {
        method: 'POST',
        body: { month, extractFile, noteFiles, dryRun },
      });
      const preview = data.preview || data;
      if (resultHost) {
        resultHost.innerHTML = renderMonthResult(preview, t);
      }
    } catch (err) {
      if (resultHost) {
        resultHost.innerHTML = `<p class="import-status import-status--err">${escapeHtml(err.message || 'Falha.')}</p>`;
      }
    } finally {
      previewBtn.disabled = false;
      applyBtn.disabled = false;
    }
  };

  previewBtn?.addEventListener('click', () => run(true));
  applyBtn?.addEventListener('click', () => run(false));
}
