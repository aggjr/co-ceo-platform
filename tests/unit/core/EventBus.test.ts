import { eventBus } from '../../../src/core/eventbus/InMemoryEventBus';
import { BaseAppEvent } from '../../../src/core/eventbus/EventBus';

describe('InMemoryEventBus', () => {
  it('permite registrar handler e publicar evento', (done) => {
    const eventName = 'test.event_published';
    const testPayload = { text: 'Hello, World!' };
    const tenantId = 'tenant-xyz';

    eventBus.subscribe(eventName, async (event) => {
      try {
        expect(event.name).toBe(eventName);
        expect(event.tenantId).toBe(tenantId);
        expect(event.payload).toEqual(testPayload);
        expect(event.id).toBeDefined();
        expect(event.timestamp).toBeInstanceOf(Date);
        done();
      } catch (error) {
        done(error);
      }
    });

    const event = new BaseAppEvent(eventName, tenantId, testPayload);
    eventBus.publish(event);
  });

  it('isola erros de handlers sem travar outros handlers ou o fluxo principal', (done) => {
    const eventName = 'test.event_error_isolation';
    const testPayload = { text: 'Error Test' };

    let firstHandlerCalled = false;
    let secondHandlerCalled = false;

    // Primeiro handler joga um erro
    eventBus.subscribe(eventName, async () => {
      firstHandlerCalled = true;
      throw new Error('Erro forçado para teste de isolamento');
    });

    // Segundo handler deve rodar normalmente mesmo com o erro do primeiro
    eventBus.subscribe(eventName, async (event) => {
      secondHandlerCalled = true;
      try {
        expect(firstHandlerCalled).toBe(true);
        expect(secondHandlerCalled).toBe(true);
        expect(event.payload).toEqual(testPayload);
        done();
      } catch (error) {
        done(error);
      }
    });

    const event = new BaseAppEvent(eventName, null, testPayload);
    eventBus.publish(event);
  });
});
