import { Request, Response } from 'express';
import crypto from 'crypto';
import { CoCeoDataGateway } from '../core/dal';
import { applyUiCatalog } from '../core/ui/UiCatalogApplyService';
import { UiManifestService } from '../core/ui/UiManifestService';
import pool from '../config/database';

export class UiManifestController {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  getManifest = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    const locale = typeof req.query.locale === 'string' ? req.query.locale : 'pt-BR';

    const service = new UiManifestService(this.gateway);
    const manifest = await service.build(ctx, locale);

    const etag = '"' + crypto.createHash('sha1').update(manifest.version).digest('hex') + '"';
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.json({ success: true, ...manifest });
  };

  /** Sincroniza catálogo UI + rótulos pt-BR no MySQL do ambiente (conexão interna). */
  applyCatalog = async (req: Request, res: Response) => {
    if (req.userContext?.scope !== 'global') {
      return res.status(403).json({
        success: false,
        error: 'Somente sessão plataforma (escopo global) pode sincronizar o catálogo UI.',
      });
    }
    try {
      const result = await applyUiCatalog(pool);
      return res.json({ success: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ success: false, error: message });
    }
  };
}
