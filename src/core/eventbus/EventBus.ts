export interface AppEvent<P = any> {
  id: string;
  name: string;
  timestamp: Date;
  tenantId: string | null;
  payload: P;
}

export type EventHandler<E extends AppEvent = AppEvent> = (event: E) => Promise<void>;

export interface IEventBus {
  publish<E extends AppEvent>(
    event: Omit<E, 'id' | 'timestamp'>
  ): Promise<void>;

  subscribe<E extends AppEvent>(
    eventName: string,
    handler: EventHandler<E>
  ): void;
}

/**
 * Evento genérico para simplificar criações dinâmicas de eventos
 */
export class BaseAppEvent<P> implements AppEvent<P> {
  readonly id: string;
  readonly timestamp: Date;
  readonly name: string;
  readonly tenantId: string | null;
  readonly payload: P;

  constructor(name: string, tenantId: string | null, payload: P) {
    this.id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    this.timestamp = new Date();
    this.name = name;
    this.tenantId = tenantId;
    this.payload = payload;
  }
}
