import { Request, Response } from 'express';
import pool from '../config/database';
import {
  isDeployWebhookConfigured,
  productionDeployTargetVersion,
  syncUiCatalogAfterDeploy,
  triggerEasypanelDeployWebhook,
} from '../core/platform/productionDeploy';
import { APP_VERSION } from '../generated/version';

export class PlatformDeployController {
  getStatus = async (_req: Request, res: Response) => {
    return res.json({
      success: true,
      runningVersion: APP_VERSION,
      webhookConfigured: isDeployWebhookConfigured(),
      note: isDeployWebhookConfigured()
        ? 'Webhook configurado no servidor. O botão pode disparar redeploy.'
        : 'Defina EASYPANEL_DEPLOY_WEBHOOK_URL nas variáveis de ambiente do app no EasyPanel.',
    });
  };

  triggerProduction = async (req: Request, res: Response) => {
    if (req.userContext?.scope !== 'global') {
      return res.status(403).json({
        success: false,
        error: 'Somente sessão plataforma (escopo global) pode publicar em produção.',
      });
    }

    if (!isDeployWebhookConfigured()) {
      return res.status(503).json({
        success: false,
        error:
          'Webhook não configurado. No EasyPanel: app co-ceo-platform → Deploy → copie a URL do webhook → ' +
          'Environment → EASYPANEL_DEPLOY_WEBHOOK_URL=<url> → Redeploy uma vez manualmente.',
        webhookConfigured: false,
        runningVersion: APP_VERSION,
      });
    }

    try {
      const { triggered } = await triggerEasypanelDeployWebhook();
      let catalog: Record<string, unknown> | null = null;
      let catalogError: string | null = null;

      try {
        catalog = await syncUiCatalogAfterDeploy(pool);
      } catch (e) {
        catalogError = e instanceof Error ? e.message : String(e);
      }

      return res.json({
        success: true,
        triggered,
        runningVersion: APP_VERSION,
        targetVersion: productionDeployTargetVersion(),
        webhookConfigured: true,
        catalogApplied: catalog != null,
        catalogError,
        message:
          'Redeploy acionado. Aguarde alguns minutos até /api/version subir. ' +
          'Recarregue a página com Ctrl+F5 após a versão mudar.',
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(502).json({ success: false, error: message });
    }
  };
}
