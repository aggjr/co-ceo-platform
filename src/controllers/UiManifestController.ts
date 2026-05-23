import { Request, Response } from 'express';
import crypto from 'crypto';
import { CoCeoDataGateway } from '../core/dal';
import { UiManifestService } from '../core/ui/UiManifestService';

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
}
