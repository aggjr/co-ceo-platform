import { Request, Response, NextFunction } from 'express';
import { AuthorizationService } from '../core/auth/AuthorizationService';

/** Exige ao menos uma das permissões listadas (OR). */
export function requireAnyPermission(...permissionCodes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userContext) {
      return res.status(401).json({ success: false, error: 'Não autenticado.' });
    }
    if (!permissionCodes.length) {
      return next();
    }
    let lastError: unknown;
    for (const code of permissionCodes) {
      try {
        await AuthorizationService.assertCan(req.userContext, code);
        return next();
      } catch (error) {
        lastError = error;
      }
    }
    const message = lastError instanceof Error ? lastError.message : 'Permissão negada.';
    const status = (lastError as { httpStatus?: number })?.httpStatus ?? 403;
    return res.status(status).json({ success: false, error: message });
  };
}
