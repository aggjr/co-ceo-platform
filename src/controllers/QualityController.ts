import { Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { QualityRegressionService } from '../core/quality/QualityRegressionService';

const ROOT = process.cwd();

export class QualityController {
  static getDashboard = async (_req: Request, res: Response) => {
    const dashboard = await QualityRegressionService.getDashboard();
    return res.json({ success: true, ...dashboard });
  };

  static getImpactPlan = async (_req: Request, res: Response) => {
    return res.json({
      success: true,
      plan: QualityRegressionService.loadImpactPlan(),
    });
  };

  /** Dispara regressão em background (somente ambiente de desenvolvimento). */
  static runRegression = async (req: Request, res: Response) => {
    if (process.env.ALLOW_QUALITY_RUN_FROM_API !== 'true') {
      return res.status(403).json({
        success: false,
        error: 'Execução via API desabilitada. Rode localmente: npm run test:regression',
      });
    }

    const mode = String(req.body?.mode || 'full');
    if (!['full', 'impact', 'unit'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'mode deve ser full, impact ou unit.' });
    }

    const persist = req.body?.persist === true;

    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'run-regression.js'), `--mode=${mode}`, ...(persist ? ['--persist'] : [])], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return res.status(202).json({
      success: true,
      message: `Regressão (${mode}) iniciada em background.`,
      triggeredBy: req.userContext?.userId,
    });
  };
}
