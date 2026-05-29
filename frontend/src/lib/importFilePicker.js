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

function folderPathFromRelativeNames(files) {
  if (!files.length) return '';
  const paths = files.map((f) => String(f.name || '').replace(/\\/g, '/'));
  const roots = new Set(paths.map((p) => p.split('/')[0]).filter(Boolean));
  if (roots.size === 1) {
    const root = [...roots][0];
    const underRoot = paths.every((p) => p === root || p.startsWith(`${root}/`));
    if (underRoot) return root;
  }
  if (roots.size > 1) return [...roots].join(' · ');
  return paths[0].includes('/') ? paths[0].split('/').slice(0, -1).join('/') : '';
}

function fileCountLabel(fileCount, folderPath) {
  if (!fileCount) return 'Nenhum arquivo selecionado';
  const hint = folderPath || 'pasta';
  return `${fileCount} arquivo(s) — ${hint}`;
}

/**
 * @param {{ extensions?: string[] }} opts — ex. ['.pdf'] ou ['.pdf', '.csv', '.txt']
 * @returns {Promise<{ files: Array<{ name: string, contentBase64: string }>, folderPath: string, fileCountLabel: string }>}
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
        const folderPath = folderPathFromRelativeNames(files);
        resolve({
          files,
          folderPath,
          fileCountLabel: fileCountLabel(files.length, folderPath),
        });
      } catch (e) {
        document.body.removeChild(input);
        reject(e);
      }
    });
    input.click();
  });
}

/** @returns {Promise<{ files: Array<{ name: string, contentBase64: string }>, folderPath: string, fileCountLabel: string }>} */
export async function pickPdfFilesFromFolder() {
  return pickFilesFromFolder({ extensions: ['.pdf'] });
}

/** Extrato BTG: PDF ou CSV */
export async function pickExtractFilesFromFolder() {
  return pickFilesFromFolder({ extensions: ['.pdf', '.csv', '.txt'] });
}
