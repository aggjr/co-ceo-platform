import { GatewayError, type GatewayErrorCode } from '../../../src/core/dal/errors';

describe('GatewayError — códigos usados pelo INVEST', () => {
  const investCodes: GatewayErrorCode[] = ['INVALID_PAYLOAD', 'INVALID_CONTEXT'];

  it.each(investCodes)('aceita código %s (tipagem + instância)', (code) => {
    const err = new GatewayError(code, 'mensagem de teste', 400);
    expect(err.code).toBe(code);
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe('mensagem de teste');
  });

  it('INVALID_PAYLOAD preserva status HTTP 400', () => {
    const err = new GatewayError('INVALID_PAYLOAD', 'Data inválida: foo', 400);
    expect(err.name).toBe('GatewayError');
    expect(err.httpStatus).toBe(400);
  });

  it('INVALID_CONTEXT preserva status HTTP 400', () => {
    const err = new GatewayError('INVALID_CONTEXT', 'Organização obrigatória.', 400);
    expect(err.httpStatus).toBe(400);
  });
});
