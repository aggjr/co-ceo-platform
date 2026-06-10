import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { OptionCRunState } from './OptionCDailyCloseOrchestrator';

/**
 * Persiste e restaura o estado de uma execução da Opção C na tabela
 * `invest_reconcile_runs`. Usado pelo OptionCDailyCloseOrchestrator
 * para sobreviver a reinicializações do servidor.
 *
 * O campo `state_json` guarda o OptionCRunState serializado (sem os
 * arquivos binários — esses ficam na memória e são re-indexados no restore).
 */
export class OptionCRunRepository {
  constructor(private readonly pool: Pool) {}

  /** Cria ou substitui o registro de um run. */
  async upsert(state: OptionCRunState): Promise<void> {
    const stateToStore = {
      ...state,
      // Trunca o activityLog para evitar crescimento ilimitado no JSON
      activityLog: state.activityLog.slice(-1000),
    };
    await this.pool.query(
      `INSERT INTO invest_reconcile_runs
         (run_id, organization_id, phase, run_status, run_error, state_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         phase       = VALUES(phase),
         run_status  = VALUES(run_status),
         run_error   = VALUES(run_error),
         state_json  = VALUES(state_json),
         updated_at  = CURRENT_TIMESTAMP`,
      [
        state.runId,
        state.organizationId,
        state.phase,
        state.runStatus ?? 'running',
        state.runError ?? null,
        JSON.stringify(stateToStore),
      ]
    );
  }

  /** Busca um run pelo runId. Retorna null se não encontrado. */
  async findById(runId: string): Promise<OptionCRunState | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT state_json FROM invest_reconcile_runs WHERE run_id = ? LIMIT 1`,
      [runId]
    );
    if (!rows.length || !rows[0]?.state_json) return null;
    try {
      return JSON.parse(rows[0].state_json) as OptionCRunState;
    } catch {
      return null;
    }
  }

  /**
   * Busca o run mais recente da organização que ainda esteja ativo
   * (run_status = 'running'). Útil para detectar runs órfãos.
   */
  async findActiveByOrg(organizationId: string): Promise<OptionCRunState | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT state_json FROM invest_reconcile_runs
       WHERE organization_id = ? AND run_status = 'running'
       ORDER BY updated_at DESC LIMIT 1`,
      [organizationId]
    );
    if (!rows.length || !rows[0]?.state_json) return null;
    try {
      return JSON.parse(rows[0].state_json) as OptionCRunState;
    } catch {
      return null;
    }
  }

  /** Marca um run como concluído ou com erro. */
  async markDone(runId: string, status: 'done' | 'error', error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE invest_reconcile_runs
       SET run_status = ?, run_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE run_id = ?`,
      [status, error ?? null, runId]
    );
  }

  /**
   * Remove runs antigos (> 30 dias) para manter a tabela enxuta.
   * Chamado oportunisticamente a cada novo start().
   */
  async pruneOld(daysToKeep = 30): Promise<void> {
    await this.pool.query(
      `DELETE FROM invest_reconcile_runs
       WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [daysToKeep]
    );
  }
}
