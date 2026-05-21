import { renderShell } from '../components/Shell.js';
import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';

export async function InvestExtratosPage(container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }

  const body = isGlobalSession()
    ? '<div class="card"><p class="muted">Personifique o titular da holding para conferir extratos.</p></div>'
    : `
      <div class="card">
        <h2 style="font-size:16px;margin:0 0 8px">Extratos de conta</h2>
        <p class="muted" style="margin:0">
          Coloque o PDF da conta em <code>data/invest/sources/btg-extracts/Extrato.pdf</code> e rode
          <code>npx ts-node scripts/convert-btg-extract-pdf.ts</code> (requer <code>pdf-parse</code> uma vez).
          O extrato cruza liquidações de bolsa (LIQ BOLSA) com notas, TEDs e saldo em conta no livro razão.
        </p>
      </div>
    `;

  await renderShell(container, {
    title: 'INVEST — Extratos de conta',
    contentHtml: body,
  });
}
