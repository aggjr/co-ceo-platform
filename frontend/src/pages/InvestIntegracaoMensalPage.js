import '../styles/invest-integracao-mensal.css';
import { apiRequest } from '../api/client.js';
import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';
import { pickPdfFilesFromFolder, pickSingleFile } from '../lib/importFilePicker.js';

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

function formatBool(ok) {
  if (ok === true) return '<span class="monthly-badge monthly-badge--ok">OK</span>';
  if (ok === false) return '<span class="monthly-badge monthly-badge--err">Falha</span>';
  return '<span class="monthly-badge">Pendente</span>';
}

function renderPreview(data) {
  const p = data?.preview || data;
  if (!p) return '<p class="muted">Aguardando validação.</p>';
  const rows = [
    ['Notas', formatBool(p.notesOk), p.notesDetail],
    ['Financeiro', formatBool(p.financialOk), p.financialDetail],
    ['Resultado', formatBool(p.resultOk), p.resultDetail],
    ['Saldo inicial extrato', formatMoney(p.openingExtract), `Livro: ${formatMoney(p.openingLedgerBalance)}`],
    ['Diferença inicial', formatMoney(p.openingLedgerDelta), ''],
    ['Saldo final extrato', formatMoney(p.closingExtract), `Livro: ${formatMoney(p.closingLedgerBalance)}`],
    ['Diferença final', formatMoney(p.closingLedgerDelta), ''],
  ];
  return `
    <table class="monthly-preview-table">
      <thead><tr><th>Item</th><th>Status / valor</th><th>Detalhe</th></tr></thead>
      <tbody>
        ${rows.map(([label, value, detail]) => `
          <tr>
            <td>${escapeHtml(label)}</td>
            <td>${value}</td>
            <td>${escapeHtml(detail || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderApplyResult(data) {
  if (!data) return '';
  return `
    <div class="monthly-result ${data.applied ? 'monthly-result--ok' : 'monthly-result--err'}">
      <strong>${data.applied ? 'Mês aplicado' : 'Mês não aplicado'}</strong>
      <span>${escapeHtml(data.resultDetail || data.error || '')}</span>
      <span>Notas: +${data.notesInserted ?? 0}/-${data.notesSkipped ?? 0} · Extrato: +${data.extractInserted ?? 0}/-${data.extractSkipped ?? 0}</span>
    </div>
  `;
}

export async function InvestIntegracaoMensalPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  if (isGlobalSession()) {
    await renderShell(container, {
      title: 'INVEST - Integração mensal',
      contentHtml: '<div class="card"><p class="muted">Personifique o titular da holding para executar a integração mensal.</p></div>',
    });
    return;
  }

  const contentHtml = `
    <div class="monthly-import-page">
      <header class="monthly-header">
        <div>
          <p class="monthly-kicker">INVEST</p>
          <h1>Integração mensal BTG</h1>
          <p class="muted">
            Valide notas e extrato do mesmo mês antes de gravar. A aplicação só é liberada quando o mês fecha com notas, caixa e resultado coerentes.
          </p>
        </div>
        <a href="/invest/conciliacao" data-link class="btn btn-ghost">Conciliação antiga</a>
      </header>

      <section class="monthly-panel">
        <div class="monthly-grid">
          <label class="monthly-field">
            <span>Mês</span>
            <input id="monthly-month" type="month" />
          </label>

          <div class="monthly-file-card">
            <span class="monthly-field-title">Extrato mensal</span>
            <button id="monthly-pick-extract" type="button" class="btn btn-file">Selecionar extrato</button>
            <small id="monthly-extract-label">Nenhum arquivo selecionado</small>
          </div>

          <div class="monthly-file-card">
            <span class="monthly-field-title">Notas do mês</span>
            <button id="monthly-pick-notes" type="button" class="btn btn-file">Selecionar pasta de notas</button>
            <small id="monthly-notes-label">Nenhuma pasta selecionada</small>
          </div>
        </div>

        <div class="monthly-actions">
          <button id="monthly-validate" type="button" class="btn btn-primary" disabled>Validar mês</button>
          <button id="monthly-apply" type="button" class="btn btn-primary monthly-apply" disabled>Aplicar mês</button>
          <span id="monthly-status" class="monthly-status">Aguardando arquivos.</span>
        </div>
      </section>

      <section class="monthly-panel">
        <div class="monthly-panel-heading">
          <div>
            <p class="monthly-kicker">Prévia</p>
            <h2>Batimento do mês</h2>
          </div>
          <span id="monthly-ready-badge" class="monthly-badge">Pendente</span>
        </div>
        <div id="monthly-preview">${renderPreview(null)}</div>
        <div id="monthly-apply-result"></div>
      </section>
    </div>
  `;

  await renderShell(container, { title: 'INVEST - Integração mensal', contentHtml });

  const monthInput = container.querySelector('#monthly-month');
  const btnPickExtract = container.querySelector('#monthly-pick-extract');
  const btnPickNotes = container.querySelector('#monthly-pick-notes');
  const btnValidate = container.querySelector('#monthly-validate');
  const btnApply = container.querySelector('#monthly-apply');
  const extractLabel = container.querySelector('#monthly-extract-label');
  const notesLabel = container.querySelector('#monthly-notes-label');
  const statusEl = container.querySelector('#monthly-status');
  const previewEl = container.querySelector('#monthly-preview');
  const readyBadge = container.querySelector('#monthly-ready-badge');
  const applyResultEl = container.querySelector('#monthly-apply-result');

  let extractFile = null;
  let noteFiles = [];
  let lastPreview = null;

  function setStatus(text, tone = '') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `monthly-status${tone ? ` monthly-status--${tone}` : ''}`;
  }

  function refreshButtons() {
    const readyForValidation = Boolean(monthInput?.value && extractFile && noteFiles.length);
    if (btnValidate) btnValidate.disabled = !readyForValidation;
    const okToApply = Boolean(lastPreview?.resultOk);
    if (btnApply) btnApply.disabled = !okToApply;
    if (readyBadge) {
      readyBadge.className = `monthly-badge ${okToApply ? 'monthly-badge--ok' : 'monthly-badge--idle'}`;
      readyBadge.textContent = okToApply ? 'Pronto para aplicar' : 'Pendente';
    }
  }

  function resetPreview() {
    lastPreview = null;
    if (previewEl) previewEl.innerHTML = renderPreview(null);
    if (applyResultEl) applyResultEl.innerHTML = '';
    refreshButtons();
  }

  async function runMonthImport(dryRun) {
    const month = monthInput?.value;
    if (!month || !extractFile || !noteFiles.length) return null;
    return apiRequest('/api/invest/import/btg-month', {
      method: 'POST',
      body: { month, dryRun, extractFile, noteFiles },
    });
  }

  btnPickExtract?.addEventListener('click', async () => {
    try {
      const result = await pickSingleFile({ extensions: ['.pdf', '.csv', '.txt'] });
      extractFile = result.file;
      if (extractLabel) extractLabel.textContent = result.file.name;
      resetPreview();
      setStatus('Extrato selecionado. Selecione as notas e valide o mês.');
    } catch (err) {
      setStatus(err.message || 'Seleção cancelada.', 'warn');
    }
  });

  btnPickNotes?.addEventListener('click', async () => {
    try {
      const result = await pickPdfFilesFromFolder();
      noteFiles = result.files;
      if (notesLabel) notesLabel.textContent = result.fileCountLabel;
      resetPreview();
      setStatus('Notas selecionadas. Valide o mês antes de aplicar.');
    } catch (err) {
      setStatus(err.message || 'Seleção cancelada.', 'warn');
    }
  });

  monthInput?.addEventListener('change', () => {
    resetPreview();
    setStatus('Mês alterado. Valide novamente.');
  });

  btnValidate?.addEventListener('click', async () => {
    btnValidate.disabled = true;
    if (btnApply) btnApply.disabled = true;
    setStatus('Validando mês no servidor...');
    try {
      const data = await runMonthImport(true);
      lastPreview = data?.preview || data;
      if (previewEl) previewEl.innerHTML = renderPreview(data);
      const ok = Boolean(lastPreview?.resultOk);
      setStatus(ok ? 'Mês validado e pronto para aplicar.' : 'Validação encontrou bloqueios.', ok ? 'ok' : 'err');
    } catch (err) {
      lastPreview = null;
      setStatus(err.message || 'Falha na validação.', 'err');
    } finally {
      refreshButtons();
    }
  });

  btnApply?.addEventListener('click', async () => {
    if (!lastPreview?.resultOk) return;
    btnApply.disabled = true;
    if (btnValidate) btnValidate.disabled = true;
    setStatus('Aplicando mês no servidor...');
    try {
      const data = await runMonthImport(false);
      if (applyResultEl) applyResultEl.innerHTML = renderApplyResult(data);
      lastPreview = data;
      if (previewEl) previewEl.innerHTML = renderPreview(data);
      if (!data?.applied) {
        setStatus('O servidor não aplicou o mês. Confira o detalhe.', 'err');
        return;
      }
      setStatus('Mês aplicado. Materializando carteira e patrimônio...');
      await apiRequest('/api/invest/reconcile/recalc-all', { method: 'POST', body: {} });
      setStatus('Mês aplicado e materialização concluída.', 'ok');
    } catch (err) {
      setStatus(err.message || 'Falha ao aplicar o mês.', 'err');
    } finally {
      refreshButtons();
    }
  });

  refreshButtons();
}
