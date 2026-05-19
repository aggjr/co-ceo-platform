import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../core/auth/AuthService';
import type { UserContext } from '../core/dal';

declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

export class AuthMiddleware {
  static protect(req: Request, res: Response, next: NextFunction) {
    let token: string | undefined;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Token não fornecido.' });
    }

    try {
      const decoded = AuthService.verifyToken(token);
      req.userContext = AuthService.toUserContext(decoded);
      next();
    } catch {
      return res.status(401).json({ success: false, error: 'Token inválido ou expirado.' });
    }
  }

  static requireGlobalScope(req: Request, res: Response, next: NextFunction) {
    if (!req.userContext) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });
    }
    if (req.userContext.scope !== 'global') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. Apenas a equipe co-CEO tem permissão para esta ação.',
      });
    }
    next();
  }
}
