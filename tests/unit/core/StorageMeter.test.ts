import { computeStorageDelta, estimatePayloadBytes } from '../../../src/core/dal/StorageMeter';

describe('StorageMeter', () => {
  it('estima bytes de payload JSON', () => {
    const bytes = estimatePayloadBytes({ a: 1, b: 'teste' });
    expect(bytes).toBeGreaterThan(0);
  });

  it('calcula delta positivo em INSERT', () => {
    const delta = computeStorageDelta('INSERT', null, { x: 1 });
    expect(delta).toBe(estimatePayloadBytes({ x: 1 }));
  });

  it('calcula delta negativo em SOFT_DELETE', () => {
    const old = { a: 1, b: 2 };
    const delta = computeStorageDelta('SOFT_DELETE', old, null);
    expect(delta).toBe(-estimatePayloadBytes(old));
  });
});
