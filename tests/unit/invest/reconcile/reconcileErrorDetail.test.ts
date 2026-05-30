import { GatewayError } from '../../../../src/core/dal/errors';
import {
  formatReconcileError,
  logReconcileFailure,
} from '../../../../src/core/invest/reconcile/reconcileErrorDetail';

describe('reconcileErrorDetail', () => {
  it('formata erro MySQL com errno e sqlMessage', () => {
    const err = Object.assign(new Error('FK fail'), {
      code: 'ER_ROW_IS_REFERENCED_2',
      errno: 1451,
      sqlMessage: 'Cannot delete or update a parent row',
    });
    const detail = formatReconcileError(err, { step: 'purge' });
    expect(detail.code).toBe('ER_ROW_IS_REFERENCED_2');
    expect(detail.errno).toBe(1451);
    expect(detail.sqlMessage).toContain('parent row');
    expect(detail.context?.step).toBe('purge');
  });

  it('logReconcileFailure inclui scope no message', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const detail = logReconcileFailure('option-c.start', 'org-1', new GatewayError(
      'INVALID_PAYLOAD',
      'teste',
      400
    ));
    expect(detail.code).toBe('INVALID_PAYLOAD');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
