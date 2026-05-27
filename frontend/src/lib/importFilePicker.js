/**
 * Input file/pasta oculto + botão estilizado (ícone pasta).
 */
export function bindImportFilePicker(container, options) {
  const {
    inputSelector,
    buttonSelector,
    labelSelector,
    emptyLabel = 'Nenhum arquivo selecionado',
    onChange,
  } = options;

  const input = container.querySelector(inputSelector);
  const button = container.querySelector(buttonSelector);
  const labelEl = labelSelector ? container.querySelector(labelSelector) : null;

  const refreshLabel = () => {
    if (!labelEl || !input) return;
    const files = input.files ? [...input.files] : [];
    if (!files.length) {
      labelEl.textContent = emptyLabel;
      labelEl.classList.remove('import-picker-name--ok');
      return;
    }
    if (files.length === 1) {
      const f = files[0];
      labelEl.textContent = f.webkitRelativePath || f.name || emptyLabel;
    } else {
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
      const first = files[0]?.webkitRelativePath || files[0]?.name || '';
      const root = first.includes('/') ? first.split('/')[0] : 'pasta';
      labelEl.textContent = `${root} · ${files.length} arquivo(s)${pdfs.length ? ` (${pdfs.length} PDF)` : ''}`;
    }
    labelEl.classList.add('import-picker-name--ok');
  };

  button?.addEventListener('click', (e) => {
    e.preventDefault();
    input?.click();
  });

  input?.addEventListener('change', () => {
    refreshLabel();
    onChange?.(input);
  });

  refreshLabel();
  return { input, refreshLabel };
}
