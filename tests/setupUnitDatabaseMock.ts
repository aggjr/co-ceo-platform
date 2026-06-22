/** Evita pool MySQL real em testes unitarios (imports transitivos de PatrimonyDailyStore/Rebuild). */
jest.mock('../src/config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn().mockResolvedValue([[], []]),
    end: jest.fn().mockResolvedValue(undefined),
    getConnection: jest.fn(),
    on: jest.fn(),
  },
}));
