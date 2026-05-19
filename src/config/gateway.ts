import pool from './database';
import { CoCeoDataGateway } from '../core/dal';

/** Instância única do gateway — API, seeds e leituras Cockpit. */
export const dataGateway = new CoCeoDataGateway(pool);
