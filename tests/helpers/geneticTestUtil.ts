/**
 * Utilitários para Testes Mutantes e Algoritmos Genéticos (Crossover) aplicados a Dados de Teste.
 * Permite expandir a cobertura de testes e expor casos de borda gerando novos descendentes e mutantes.
 */

export interface GeneticGeneratorOptions<T> {
  mutationRate?: number; // Probabilidade de mutação (0 a 1)
  crossoverRate?: number; // Probabilidade de crossover (0 a 1)
  extremeValues?: { [K in keyof T]?: any[] }; // Valores extremos definidos pelo desenvolvedor
}

/**
 * Realiza o cruzamento (Crossover) entre dois objetos pais para gerar descendentes.
 * Herda aleatoriamente chaves de ambos os pais para construir a tupla filha.
 */
export function crossoverTuples<T extends Record<string, any>>(parentA: T, parentB: T): T {
  const child: Record<string, any> = {};
  const keys = Object.keys(parentA);

  // Ponto de corte simples para crossover
  const cutPoint = Math.floor(Math.random() * keys.length);

  keys.forEach((key, idx) => {
    if (idx < cutPoint) {
      child[key] = parentA[key];
    } else {
      child[key] = parentB[key];
    }
  });

  return child as T;
}

/**
 * Aplica mutações a um objeto com base em regras de tipo e valores extremos.
 */
export function mutateTuple<T extends Record<string, any>>(
  tuple: T,
  options: GeneticGeneratorOptions<T> = {}
): T {
  const mutated: Record<string, any> = { ...tuple };
  const mutationRate = options.mutationRate ?? 0.2;
  const extremeValues = (options.extremeValues || {}) as Record<string, any[]>;

  for (const key of Object.keys(mutated)) {
    if (Math.random() > mutationRate) {
      continue; // Não aplica mutação nesta propriedade
    }

    const value = mutated[key];

    // Se houver valores extremos específicos catalogados
    if (extremeValues[key] && extremeValues[key].length > 0) {
      const list = extremeValues[key];
      mutated[key] = list[Math.floor(Math.random() * list.length)];
      continue;
    }

    // Mutador padrão baseado no tipo do dado
    if (typeof value === 'number') {
      const mutType = Math.random();
      if (mutType < 0.25) {
        mutated[key] = -value; // Inversão de sinal
      } else if (mutType < 0.5) {
        mutated[key] = 0; // Zerar
      } else if (mutType < 0.75) {
        mutated[key] = value * 1000; // Multiplicação por escala alta
      } else {
        mutated[key] = Number.NaN; // Not a Number
      }
    } else if (typeof value === 'string') {
      const mutType = Math.random();
      if (mutType < 0.33) {
        mutated[key] = ''; // String vazia
      } else if (mutType < 0.66) {
        mutated[key] = ' '; // Apenas espaços
      } else {
        mutated[key] = `MUTANT_${value}_${Math.random().toString(36).substring(7)}`; // Corrupção estrutural
      }
    } else if (value instanceof Date) {
      const mutType = Math.random();
      if (mutType < 0.5) {
        mutated[key] = new Date(0); // Epoch
      } else {
        mutated[key] = new Date(value.getTime() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 anos no futuro
      }
    } else if (value === null || value === undefined) {
      // Tenta introduzir valores válidos para ver a tolerância
      mutated[key] = 'DUMMY_VALUE';
    }
  }

  return mutated as T;
}

/**
 * Algoritmo Genético de Geração de Massa de Testes:
 * Recebe uma população inicial de tuplas de teste (casos de sucesso conhecidos)
 * e gera uma nova geração maior contendo combinações e mutantes.
 */
export function generateTestGeneration<T extends Record<string, any>>(
  initialPopulation: T[],
  generationSize: number,
  options: GeneticGeneratorOptions<T> = {}
): T[] {
  if (initialPopulation.length < 2) {
    throw new Error('A população inicial de teste precisa de pelo menos 2 tuplas para crossover.');
  }

  const results: T[] = [...initialPopulation];

  while (results.length < generationSize) {
    // Escolhe dois pais aleatórios da população acumulada
    const idxA = Math.floor(Math.random() * results.length);
    let idxB = Math.floor(Math.random() * results.length);
    while (idxA === idxB && results.length > 1) {
      idxB = Math.floor(Math.random() * results.length);
    }

    const parentA = results[idxA];
    const parentB = results[idxB];

    // Crossover
    let child = crossoverTuples(parentA, parentB);

    // Mutação
    child = mutateTuple(child, options);

    results.push(child);
  }

  return results;
}
