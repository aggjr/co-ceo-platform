/**
 * Seleção de pasta/arquivos no navegador (não persiste no servidor).
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function folderLabelFromFiles(files) {
  if (!files.length) return '';
  const dirs = new Set();
  for (const f of files) {
    const p = String(f.name || '');
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length > 1) dirs.add(parts[0]);
  }
  const dirHint = dirs.size === 1 ? [...dirs][0] : `${dirs.size} pastas`;
  return `${files.length} arquivo(s) — ${dirHint}`;
}

/**
 * @param {{ extensions?: string[] }} opts — ex. ['.pdf'] ou ['.pdf', '.csv', '.txt']
 * @returns {Promise<{ files: Array<{ name: string, contentBase64: string }>, label: string }>}
 */
export async function pickFilesFromFolder(opts = {}) {
  const exts = (opts.extensions || ['.pdf']).map((e) =>
    e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`
  );

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = exts.join(',');
    input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      try {
        const raw = [...(input.files || [])];
        const matched = raw.filter((f) => {
          const n = f.name.toLowerCase();
          return exts.some((ext) => n.endsWith(ext));
        });
        const files = await Promise.all(
          matched.map(async (f) => ({
            name: f.webkitRelativePath || f.name,
            contentBase64: await readFileAsBase64(f),
          }))
        );
        document.body.removeChild(input);
        resolve({ files, label: folderLabelFromFiles(files) });
      } catch (e) {
        document.body.removeChild(input);
        reject(e);
      }
    });
    input.click();
  });
}

/** @returns {Promise<{ files: Array<{ name: string, contentBase64: string }>, label: string }>} */
export async function pickPdfFilesFromFolder() {
  return pickFilesFromFolder({ extensions: ['.pdf'] });
}

/** Extrato BTG: PDF ou CSV */
export async function pickExtractFilesFromFolder() {
  return pickFilesFromFolder({ extensions: ['.pdf', '.csv', '.txt'] });
}
