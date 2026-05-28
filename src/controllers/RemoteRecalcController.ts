import { Request, Response } from 'express';
import { PatrimonyDailyRecorder } from '../core/invest/PatrimonyDailyRecorder';

export class RemoteRecalcController {
  constructor(private gateway: any) {}

  public recalcCurve = async (req: Request, res: Response): Promise<Response> => {
    try {
      console.log('[RemoteRecalc] Iniciando recalculo da curva no servidor...');
      const ctx = req.userContext!;
      const orgId = ctx.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: 'Falta orgId' });
      }

      const recorder = new PatrimonyDailyRecorder(this.gateway);

      const start = new Date('2026-01-01');
      const end = new Date();
      
      const results = [];
      let current = new Date(start);

      while (current <= end) {
        const dateStr = current.toISOString().slice(0, 10);
        console.log(`[RemoteRecalc] Recalculando para ${dateStr}...`);
        try {
          const result = await recorder.recordDay(ctx, dateStr);
          results.push({ date: dateStr, patrimony: result.economicPatrimony });
        } catch (err: any) {
          console.warn(`[RemoteRecalc] Erro em ${dateStr}: ${err.message}`);
        }
        current.setDate(current.getDate() + 1);
      }

      console.log('[RemoteRecalc] Concluído!');
      return res.json({ success: true, processed: results.length, results });

    } catch (error: any) {
      console.error('[RemoteRecalc] Erro:', error);
      return res.status(500).json({ error: error.message });
    }
  };
}
