/**
 * Normaliza o Extrato.txt do BTG (formato PDF extraído onde cada lançamento
 * ocupa 2 linhas: linha 1 = data+descrição, linha 2 = saldo+valor) para
 * o formato de 1 linha por lançamento esperado pelo BtgExtractLineParser.
 *
 * Saída: data/invest/sources/btg-extracts/Extrato-normalized.txt
 *
 * Uso: node scripts/normalize-btg-extract.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'dados importação', 'Extrato.txt');
const DST = path.join(__dirname, '..', 'data', 'invest', 'sources', 'btg-extracts', 'Extrato-normalized.txt');

const DATE_LINE_RE = /^\d{2}\/\d{2}\/\d{4}\s+\S/;
// Linha só com numeros BR (saldo + valor) – pode vir colada sem espaço.
const NUMBERS_ONLY_RE = /^[\d.,\s]+$/;

const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split(/\r?\n/);

const out = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i].trim();

  // Cabeçalho / rodapé: passa direto
  if (!line || line.match(/^\d+ de \d+$/) || line.startsWith('Extrato de') ||
      line.startsWith('Conta Corrente') || line.startsWith('Período de') ||
      line.startsWith('AUGUSTO') || line.startsWith('Conta Corrente:') ||
      line.startsWith('CPF:') || line.startsWith('Informações') ||
      line.startsWith('Agência:') || line.startsWith('Banco:') ||
      line.startsWith('DataDescr') || line.startsWith('Total de')) {
    out.push(line);
    i++;
    continue;
  }

  // Linha de saldo inicial
  if (line.startsWith('Saldo Inicial') || line.startsWith(' Saldo Inicial')) {
    out.push(line);
    i++;
    continue;
  }

  // Linha que começa com data
  if (DATE_LINE_RE.test(line)) {
    // Verifica se a próxima linha não começa com data (seria a linha de números)
    const nextLine = (lines[i + 1] || '').trim();
    const nextIsDate = DATE_LINE_RE.test(nextLine);
    const nextIsNumbers = NUMBERS_ONLY_RE.test(nextLine) && nextLine.length > 0;

    if (!nextIsDate && nextIsNumbers) {
      // Junta as duas linhas: "DD/MM/YYYY DESC\tSALDO\tVALOR"
      // Os números na linha 2 podem vir colados. Precisamos separá-los.
      // Formato: "59.158,27399,48" = saldo(59.158,27) + valor(399,48)
      // Usamos o fato de que são separados por BR_NUMBER pattern
      const nums = [...nextLine.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map(m => m[1]);
      if (nums.length >= 2) {
        // Penúltimo = saldo, último = valor (padrão BTG)
        const saldo = nums[nums.length - 2];
        const valor = nums[nums.length - 1];
        out.push(`${line} ${saldo}\t${valor}`);
      } else if (nums.length === 1) {
        // Só um número: descrição continua na próxima linha ou só saldo
        out.push(`${line} ${nextLine}`);
      } else {
        out.push(line);
      }
      i += 2;
    } else if (!nextIsDate && !nextIsNumbers && nextLine.length > 0 && !nextLine.startsWith('Movim') && !nextLine.startsWith('Total')) {
      // Descrição que transbordou para a linha seguinte + depois mais uma linha de números
      const afterNext = (lines[i + 2] || '').trim();
      const afterNextIsNumbers = NUMBERS_ONLY_RE.test(afterNext) && afterNext.length > 0;
      if (afterNextIsNumbers) {
        const fullDesc = `${line} ${nextLine}`;
        const nums = [...afterNext.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map(m => m[1]);
        if (nums.length >= 2) {
          const saldo = nums[nums.length - 2];
          const valor = nums[nums.length - 1];
          out.push(`${fullDesc} ${saldo}\t${valor}`);
        } else {
          out.push(`${fullDesc} ${afterNext}`);
        }
        i += 3;
      } else {
        out.push(line);
        i++;
      }
    } else {
      // Linha com data e números já na mesma linha, ou apenas descrição
      out.push(line);
      i++;
    }
    continue;
  }

  // Cabeçalho de seção
  if (line.startsWith('Movimentação') || line.startsWith('Movimentacao')) {
    out.push(line);
    i++;
    continue;
  }

  // Linha genérica
  out.push(line);
  i++;
}

const result = out.join('\n');
fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, result, 'utf8');

// Validação
const outLines = out.filter(l => /^\d{2}\/\d{2}\/\d{4}\s/.test(l.trim()));
console.log(`Normalizado: ${outLines.length} lançamentos de data`);
console.log(`Escrito em: ${DST}`);

// Mostra primeiras 8 linhas com data para validação visual
console.log('\nPrimeiras 8 linhas com data:');
outLines.slice(0, 8).forEach(l => console.log(' ', l.slice(0, 90)));
