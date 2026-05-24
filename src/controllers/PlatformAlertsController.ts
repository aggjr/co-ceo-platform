import { Request, Response } from 'express';
import type { CoCeoDataGateway } from '../core/dal';
import { PlatformJobMonitorService } from '../core/platform/PlatformJobMonitorService';

export class PlatformAlertsController {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  listUnread = async (req: Request, res: Response) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const service = new PlatformJobMonitorService(this.gateway);
    const alerts = await service.listUnreadAlerts(req.userContext!, limit);
    return res.json({
      success: true,
      count: alerts.length,
      alerts: alerts.map((row) => ({
        id: String(row.id),
        jobKey: String(row.job_key ?? ''),
        jobRunId: row.job_run_id ? String(row.job_run_id) : null,
        severity: String(row.severity ?? 'info'),
        title: String(row.title ?? ''),
        body: String(row.body ?? ''),
        createdAt: row.created_at,
      })),
    });
  };

  acknowledge = async (req: Request, res: Response) => {
    const alertId = String(req.params.alertId ?? '').trim();
    if (!alertId) {
      return res.status(400).json({ success: false, error: 'alertId obrigatório.' });
    }
    const service = new PlatformJobMonitorService(this.gateway);
    await service.acknowledgeAlert(alertId, req.userContext!.userId);
    return res.json({ success: true });
  };
}
