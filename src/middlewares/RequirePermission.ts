import { Request, Response, NextFunction } from 'express';
import { AuthorizationService } from '../core/auth/AuthorizationService';

export function requirePermission(...permissionCodes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userContext) {
      return res.status(401).json({ success: false, error: 'Não autenticado.' });
    }
    try {
      for (const code of permissionCodes) {
        await AuthorizationService.assertCan(req.userContext, code);
      }
      next();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Permissão negada.';
      const status = (error as { httpStatus?: number }).httpStatus ?? 403;
      return res.status(status).json({ success: false, error: message });
    }
  };
}
