import { crossoverTuples, mutateTuple, generateTestGeneration } from '../../../tests/helpers/geneticTestUtil';

interface TestRecord {
  ticker: string;
  quantity: number;
  price: number;
  date: Date;
}

describe('GeneticTestUtil', () => {
  const parentA: TestRecord = {
    ticker: 'PETR4',
    quantity: 100,
    price: 35.5,
    date: new Date('2026-05-18'),
  };

  const parentB: TestRecord = {
    ticker: 'VALE3',
    quantity: 200,
    price: 68.2,
    date: new Date('2026-05-19'),
  };

  it('realiza crossover corretamento mesclando campos', () => {
    const child = crossoverTuples(parentA, parentB);
    expect(['PETR4', 'VALE3']).toContain(child.ticker);
    expect([100, 200]).toContain(child.quantity);
    expect([35.5, 68.2]).toContain(child.price);
  });

  it('aplica mutação de tipos numéricos e strings', () => {
    // Força mutação em 100% dos campos
    const mutant = mutateTuple(parentA, { mutationRate: 1.0 });

    // Número mutou para negativo, zero, grande escala ou NaN
    if (!Number.isNaN(mutant.quantity)) {
      expect(mutant.quantity).not.toBe(100);
    }

    // String mutou para vazia, espaço ou padrão mutante
    expect(mutant.ticker).not.toBe('PETR4');
  });

  it('gera população estendida a partir de população inicial', () => {
    const population = [parentA, parentB];
    const newGeneration = generateTestGeneration(population, 10, {
      mutationRate: 0.3,
    });

    expect(newGeneration.length).toBe(10);
    expect(newGeneration[0]).toEqual(parentA);
    expect(newGeneration[1]).toEqual(parentB);
  });
});
