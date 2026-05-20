import { BaseAppEvent, type AppEvent, type EventHandler, type IEventBus } from './EventBus';

export class InMemoryEventBus implements IEventBus {
  private handlers = new Map<string, EventHandler<any>[]>();

  async publish<E extends AppEvent>(
    event: Omit<E, 'id' | 'timestamp'>
  ): Promise<void> {
    const fullEvent: E = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      timestamp: new Date(),
      ...event,
    } as unknown as E;

    const list = this.handlers.get(fullEvent.name) || [];

    // Invoca handlers em segundo plano (desacoplado do event-loop principal)
    for (const handler of list) {
      setImmediate(async () => {
        try {
          await handler(fullEvent);
        } catch (err) {
          console.error(
            `[InMemoryEventBus] Erro ao processar evento "${fullEvent.name}" no handler:`,
            err
          );
        }
      });
    }
  }

  subscribe<E extends AppEvent>(
    eventName: string,
    handler: EventHandler<E>
  ): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName)!.push(handler);
  }
}

// Exporta uma instância única global
export const eventBus = new InMemoryEventBus();
