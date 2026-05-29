/**
 * Seleção de pasta/arquivos PDF no navegador (não persiste no servidor).
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

/**
 * @returns {Promise<Array<{ name: string, contentBase64: string }>>}
 */
export async function pickPdfFilesFromFolder() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'application/pdf,.pdf';
    input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      try {
        const raw = [...(input.files || [])];
        const pdfs = raw.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
        const files = await Promise.all(
          pdfs.map(async (f) => ({
            name: f.webkitRelativePath || f.name,
            contentBase64: await readFileAsBase64(f),
          }))
        );
        document.body.removeChild(input);
        resolve(files);
      } catch (e) {
        document.body.removeChild(input);
        reject(e);
      }
    });
    input.click();
  });
}
