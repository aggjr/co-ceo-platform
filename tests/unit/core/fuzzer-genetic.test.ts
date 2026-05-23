import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Genetic Fuzzing Stability Test', () => {
  it('should run the genetic fuzzer without throwing exceptions', () => {
    // Apenas certifica que o script executa do início ao fim sem quebrar o Node
    // Na prática da regressão, ele irá produzir o report json
    let output = '';
    try {
      output = execSync('node scripts/genetic-fuzzer.js', { encoding: 'utf-8' });
    } catch (e) {
      console.warn("Fuzzer não rodou com sucesso:", e);
    }
    
    const successCondition = output.includes('Fuzzing concluído') || output.includes('não bateu a cota') || output.includes('Skipped stress tests');
    expect(successCondition).toBe(true);
    
    // Verifica se gerou o arquivo de falhas (seja report vazio, skipped ou cheio)
    const p = path.join(process.cwd(), 'fuzzing_report.json');
    expect(fs.existsSync(p)).toBe(true);
    
    const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(Array.isArray(content)).toBe(true);
  }, 30000); // 30s timeout
});
