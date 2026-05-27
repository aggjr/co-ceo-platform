import '../styles/invest-importacao.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { getPageTexts } from '../navigation/pageTexts.js';

const TEXT_FALLBACKS = {
  'screen.invest.importacao.title': 'Importar fontes BTG',
  'screen.invest.importacao.lead':
    'Selecione a pasta de extratos mensais (PDF/CSV) e a pasta de notas de corretagem (PDF). O batimento valida saldo inicial/final de cada mês e a cadeia entre arquivos antes de gravar.',
  'screen.invest.importacao.extract_title': 'Extratos mensais (conta corrente)',
  'screen.invest.importacao.extract_help':
    'Abra a pasta com um extrato por mês (PDF ou CSV). A tabela mostra se o saldo inicial bate com o mês anterior e com o livro, e se o saldo final bate com o livro na última data do arquivo.',
  'screen.invest.importacao.notes_title': 'Notas de corretagem',
  'screen.invest.importacao.notes_help':
    'Selecione a pasta que contém os PDFs (inclui subpastas). Apenas arquivos .pdf são processados.',
  'action.invest.importacao.preview': 'Analisar',
  'action.invest.importacao.apply': 'Importar no livro',
  'label.invest.importacao.dry_run': 'Só analisar (não gravar)',
  'column.invest.importacao.path': 'Arquivo',
  'column.invest.importacao.month': 'Mês',
  'column.invest.importacao.read': 'Leitura',
  'column.invest.importacao.import': 'Importação',
  'column.invest.importacao.opening': 'Saldo ini.',
  'column.invest.importacao.closing': 'Saldo fim',
  'column.invest.importacao.chain': 'Cadeia',
  'column.invest.importacao.ledger_open': 'Livro ini.',
  'column.invest.importacao.ledger_close': 'Livro fim',
  'column.invest.importacao.notes': 'Notas',
  'column.invest.importacao.lines': 'Lançamentos',
  'column.invest.importacao.detail': 'Detalhe',
};

function statusBadge(ok, labelOk = 'OK', labelErr = 'Não') {
  if (ok === true) {
    return `<span class="import-status import-status--ok">${labelOk}</span>`;
  }
  if (ok === false) {
    return `<span class="import-status import-status--err">${labelErr}</span>`;
  }
  return `<span class="import-status import-status--muted">—</span>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtBrl(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function reconCell(ok, delta) {
  const badge = statusBadge(ok);
  if (delta != null && ok === false) {
    return `${badge}<br><span class="import-delta">Δ ${fmtBrl(delta)}</span>`;
  }
  return badge;
}

function renderExtractBatchTable(fileResults, chainOk, blockedMessage, totals, t) {
  if (!fileResults?.length) {
    return '<p class="muted">Nenhum extrato na pasta ou ainda não analisado.</p>';
  }

  const rows = fileResults
    .map((r) => {
      const detail =
        r.importBlockReason
        || r.importError
        || r.parseError
        || (r.monthAlreadyImported ? `Mês ${r.month} já importado no livro` : '')
        || (r.preview
          ? `${r.preview.entryCount} lanç. · ${r.preview.firstDate ?? '—'} → ${r.preview.lastDate ?? '—'}`
          : '');
      return `
        <tr class="${r.importBlocked ? 'import-row--blocked' : ''}">
          <td class="import-path-cell" title="${escapeHtml(r.path)}">${escapeHtml(r.fileName || r.path)}</td>
          <td>${escapeHtml(r.month || '—')}</td>
          <td>${statusBadge(r.parseOk, 'OK', 'Erro')}</td>
          <td>${r.importOk === undefined ? statusBadge(null) : statusBadge(r.importOk, 'OK', 'Erro')}</td>
          <td class="import-money">${fmtBrl(r.openingExtract)}</td>
          <td class="import-money">${fmtBrl(r.closingExtract)}</td>
          <td>${reconCell(r.openingChainOk, r.openingChainDelta)}</td>
          <td>${reconCell(r.openingLedgerOk, r.openingLedgerDelta)}</td>
          <td>${reconCell(r.closingLedgerOk, r.closingLedgerDelta)}</td>
          <td class="import-detail-cell">${escapeHtml(detail)}</td>
        </tr>
      `;
    })
    .join('');

  const chainBanner =
    chainOk === false
      ? `<p class="import-status import-status--err import-banner">${escapeHtml(
          blockedMessage
            || 'Cadeia de saldos quebrada entre os extratos do lote. Corrija os arquivos antes de importar.'
        )}</p>`
      : '';

  const foot = totals
    ? `<p class="muted import-totals">Total gravado: ${totals.inserted ?? 0} inseridos, ${totals.skipped ?? 0} pulados</p>`
    : '';

  return `
    ${chainBanner}
    <table class="import-status-table import-status-table--extract">
      <thead>
        <tr>
          <th>${t['column.invest.importacao.path']}</th>
          <th>${t['column.invest.importacao.month']}</th>
          <th>${t['column.invest.importacao.read']}</th>
          <th>${t['column.invest.importacao.import']}</th>
          <th>${t['column.invest.importacao.opening']}</th>
          <th>${t['column.invest.importacao.closing']}</th>
          <th>${t['column.invest.importacao.chain']}</th>
          <th>${t['column.invest.importacao.ledger_open']}</th>
          <th>${t['column.invest.importacao.ledger_close']}</th>
          <th>${t['column.invest.importacao.detail']}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${foot}
  `;
}

function renderNotesTable(fileResults, totals, t) {
  if (!fileResults?.length) {
    return '<p class="muted">Nenhum arquivo na pasta ou ainda não analisado.</p>';
  }
  const rows = fileResults
    .map((r) => {
      const detail =
        r.parseError
        || r.importError
        || (r.parseOk
          ? `${r.notesCount} nota(s) · ${r.ledgerLines} lanç. gerados${r.importOk ? ` · gravados ${r.inserted ?? 0}, pulados ${r.skipped ?? 0}` : ''}`
          : '');
      return `
        <tr>
          <td class="import-path-cell" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</td>
          <td>${statusBadge(r.parseOk, 'OK', 'Erro')}</td>
          <td>${r.importOk === undefined ? statusBadge(null) : statusBadge(r.importOk, 'OK', 'Erro')}</td>
          <td>${r.notesCount ?? '—'}</td>
          <td>${r.ledgerLines ?? '—'}</td>
          <td class="import-detail-cell">${escapeHtml(detail)}</td>
        </tr>
      `;
    })
    .join('');

  const foot = totals
    ? `<p class="muted import-totals">Total gravado: ${totals.inserted ?? 0} inseridos, ${totals.skipped ?? 0} pulados · custódia ${totals.reconcile?.positions ?? '—'} pos.</p>`
    : '';

  return `
    <table class="import-status-table">
      <thead>
        <tr>
          <th>${t['column.invest.importacao.path']}</th>
          <th>${t['column.invest.importacao.read']}</th>
          <th>${t['column.invest.importacao.import']}</th>
          <th>${t['column.invest.importacao.notes']}</th>
          <th>${t['column.invest.importacao.lines']}</th>
          <th>${t['column.invest.importacao.detail']}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${foot}
  `;
}

function readFilesAsPayload(fileList) {
  const files = [...fileList];
  return Promise.all(
    files.map(
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

function collectExtractFiles(fileList) {
  return [...fileList].filter((f) => /\.(pdf|csv|txt)$/i.test(f.name));
}

function collectPdfFiles(fileList) {
  return [...fileList].filter((f) => /\.pdf$/i.test(f.name));
}

function bindExtractPanel(container, t) {
  const dirInput = container.querySelector('#import-extract-dir');
  const fileInput = container.querySelector('#import-extract-files');
  const pathDisplay = container.querySelector('#import-extract-path');
  const tableHost = container.querySelector('#import-extract-table');
  const dryRun = container.querySelector('#import-extract-dry');
  const previewBtn = container.querySelector('#import-extract-preview');
  const applyBtn = container.querySelector('#import-extract-apply');

  let selectedFiles = [];

  const updatePathSummary = () => {
    if (!pathDisplay) return;
    if (!selectedFiles.length) {
      pathDisplay.textContent = 'Nenhuma pasta selecionada';
      return;
    }
    const extracts = collectExtractFiles(selectedFiles);
    const first = extracts[0]?.webkitRelativePath || extracts[0]?.name || '';
    const root = first.includes('/') ? first.split('/')[0] : '(arquivos avulsos)';
    pathDisplay.textContent = `${root} · ${extracts.length} extrato(s) PDF/CSV/TXT`;
  };

  dirInput?.addEventListener('change', () => {
    selectedFiles = dirInput.files ? [...dirInput.files] : [];
    updatePathSummary();
  });

  fileInput?.addEventListener('change', () => {
    selectedFiles = fileInput.files ? [...fileInput.files] : [];
    updatePathSummary();
  });

  const run = async (forceDry) => {
    const extracts = collectExtractFiles(selectedFiles);
    if (!extracts.length) {
      if (tableHost) {
        tableHost.innerHTML =
          '<p class="import-status import-status--err">Selecione uma pasta com extratos mensais (PDF ou CSV).</p>';
      }
      return;
    }
    const isDry = forceDry || Boolean(dryRun?.checked);
    previewBtn.disabled = true;
    applyBtn.disabled = true;
    if (tableHost) {
      tableHost.innerHTML = `<p class="muted">Analisando ${extracts.length} extrato(s)...</p>`;
    }
    try {
      const files = await readFilesAsPayload(extracts);
      const data = await apiRequest('/api/invest/import/btg-extract', {
        method: 'POST',
        body: { files, dryRun: isDry },
      });
      const preview = data.preview;
      const fileResults = preview?.fileResults || data.fileResults || [];
      if (tableHost) {
        tableHost.innerHTML = renderExtractBatchTable(
          fileResults,
          preview?.chainOk ?? data.chainOk,
          data.blockedMessage,
          isDry ? null : data.totals,
          t
        );
      }
    } catch (err) {
      if (tableHost) {
        tableHost.innerHTML = `<p class="import-status import-status--err">${escapeHtml(err.message || 'Falha no extrato.')}</p>`;
      }
    } finally {
      previewBtn.disabled = false;
      applyBtn.disabled = false;
    }
  };

  previewBtn?.addEventListener('click', () => run(true));
  applyBtn?.addEventListener('click', () => {
    if (dryRun?.checked) {
      run(true);
      return;
    }
    run(false);
  });
}

function bindNotesPanel(container, t) {
  const dirInput = container.querySelector('#import-notes-dir');
  const fileInput = container.querySelector('#import-notes-files');
  const pathDisplay = container.querySelector('#import-notes-path');
  const tableHost = container.querySelector('#import-notes-table');
  const dryRun = container.querySelector('#import-notes-dry');
  const previewBtn = container.querySelector('#import-notes-preview');
  const applyBtn = container.querySelector('#import-notes-apply');

  let selectedFiles = [];

  const updatePathSummary = () => {
    if (!pathDisplay) return;
    if (!selectedFiles.length) {
      pathDisplay.textContent = 'Nenhuma pasta/arquivos selecionados';
      return;
    }
    const pdfs = collectPdfFiles(selectedFiles);
    const first = pdfs[0]?.webkitRelativePath || pdfs[0]?.name || '';
    const root = first.includes('/') ? first.split('/')[0] : '(arquivos avulsos)';
    pathDisplay.textContent = `${root} · ${pdfs.length} PDF(s) de ${selectedFiles.length} arquivo(s) total`;
  };

  dirInput?.addEventListener('change', () => {
    selectedFiles = dirInput.files ? [...dirInput.files] : [];
    updatePathSummary();
  });

  fileInput?.addEventListener('change', () => {
    selectedFiles = fileInput.files ? [...fileInput.files] : [];
    updatePathSummary();
  });

  const run = async (forceDry) => {
    const pdfs = collectPdfFiles(selectedFiles);
    if (!pdfs.length) {
      if (tableHost) {
        tableHost.innerHTML =
          '<p class="import-status import-status--err">Selecione uma pasta ou arquivos com pelo menos um PDF.</p>';
      }
      return;
    }
    const isDry = forceDry || Boolean(dryRun?.checked);
    previewBtn.disabled = true;
    applyBtn.disabled = true;
    if (tableHost) {
      tableHost.innerHTML = `<p class="muted">Analisando ${pdfs.length} PDF(s)...</p>`;
    }
    try {
      const files = await readFilesAsPayload(pdfs);
      const data = await apiRequest('/api/invest/import/btg-brokerage-notes', {
        method: 'POST',
        body: { files, dryRun: isDry },
      });
      const fileResults = data.preview?.fileResults || data.fileResults || [];
      if (tableHost) {
        tableHost.innerHTML = renderNotesTable(fileResults, isDry ? null : data.totals, t);
      }
    } catch (err) {
      if (tableHost) {
        tableHost.innerHTML = `<p class="import-status import-status--err">${escapeHtml(err.message || 'Falha nas notas.')}</p>`;
      }
    } finally {
      previewBtn.disabled = false;
      applyBtn.disabled = false;
    }
  };

  previewBtn?.addEventListener('click', () => run(true));
  applyBtn?.addEventListener('click', () => {
    if (dryRun?.checked) {
      run(true);
      return;
    }
    run(false);
  });
}

export async function InvestImportacaoPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const t = await getPageTexts(Object.keys(TEXT_FALLBACKS), TEXT_FALLBACKS);
  const title = t['screen.invest.importacao.title'];

  if (isGlobalSession()) {
    await renderShell(container, {
      title: `INVEST — ${title}`,
      contentHtml:
        '<div class="card"><p class="muted">Personifique o titular da holding para importar extratos e notas.</p></div>',
    });
    return;
  }

  const content = `
    <p class="muted" style="margin-bottom:1rem">${t['screen.invest.importacao.lead']}</p>
    <div class="invest-import-grid">
      <div class="card invest-import-card invest-import-card--wide">
        <h2>${t['screen.invest.importacao.extract_title']}</h2>
        <p class="muted">${t['screen.invest.importacao.extract_help']}</p>
        <div class="invest-import-drop">
          <label class="import-field-label">Pasta com extratos mensais</label>
          <input type="file" id="import-extract-dir" webkitdirectory directory multiple />
          <label class="import-field-label" style="margin-top:0.75rem">Ou arquivos avulsos (PDF/CSV)</label>
          <input type="file" id="import-extract-files" accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain" multiple />
          <p class="import-path-label">Origem:</p>
          <p id="import-extract-path" class="import-path-value muted">Nenhuma pasta selecionada</p>
        </div>
        <div class="invest-import-actions">
          <label><input type="checkbox" id="import-extract-dry" /> ${t['label.invest.importacao.dry_run']}</label>
          <button type="button" class="btn btn-secondary" id="import-extract-preview">${t['action.invest.importacao.preview']}</button>
          <button type="button" class="btn btn-primary" id="import-extract-apply">${t['action.invest.importacao.apply']}</button>
        </div>
        <div id="import-extract-table" class="import-table-host"></div>
      </div>
      <div class="card invest-import-card invest-import-card--wide">
        <h2>${t['screen.invest.importacao.notes_title']}</h2>
        <p class="muted">${t['screen.invest.importacao.notes_help']}</p>
        <div class="invest-import-drop">
          <label class="import-field-label">Pasta com notas (recomendado)</label>
          <input type="file" id="import-notes-dir" webkitdirectory directory multiple />
          <label class="import-field-label" style="margin-top:0.75rem">Ou selecione PDFs avulsos</label>
          <input type="file" id="import-notes-files" accept=".pdf,application/pdf" multiple />
          <p class="import-path-label">Origem:</p>
          <p id="import-notes-path" class="import-path-value muted">Nenhuma pasta/arquivos selecionados</p>
        </div>
        <div class="invest-import-actions">
          <label><input type="checkbox" id="import-notes-dry" /> ${t['label.invest.importacao.dry_run']}</label>
          <button type="button" class="btn btn-secondary" id="import-notes-preview">${t['action.invest.importacao.preview']}</button>
          <button type="button" class="btn btn-primary" id="import-notes-apply">${t['action.invest.importacao.apply']}</button>
        </div>
        <div id="import-notes-table" class="import-table-host"></div>
      </div>
    </div>
  `;

  await renderShell(container, { title: `INVEST — ${title}`, contentHtml: content });

  bindExtractPanel(container, t);
  bindNotesPanel(container, t);
}
