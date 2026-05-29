import { Request, Response } from 'express';
import { AuthService } from '../core/auth/AuthService';
import { AuthRepository } from '../core/auth/AuthRepository';
import { IamAuditService } from '../core/auth/IamAuditService';
import { dataGateway } from '../config/gateway';

export class AuthController {
  static async login(req: Request, res: Response) {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'E-mail e senha obrigatórios.' });
      }
      const result = await AuthService.login(email, password);
      return res.status(200).json({ success: true, ...result });
    } catch (error: unknown) {
      const status = (error as { httpStatus?: number }).httpStatus ?? 500;
      const message = error instanceof Error ? error.message : 'Erro interno';
      return res.status(status).json({ success: false, error: message });
    }
  }

  static async selectContext(req: Request, res: Response) {
    try {
      const { userRoleId, userId } = req.body;
      if (!userRoleId || !userId) {
        return res.status(400).json({ success: false, error: 'userId e userRoleId obrigatórios.' });
      }
      const token = await AuthService.selectContext(userId, userRoleId);
      return res.status(200).json({ success: true, token });
    } catch (error: unknown) {
      const status = (error as { httpStatus?: number }).httpStatus ?? 500;
      const message = error instanceof Error ? error.message : 'Erro interno';
      return res.status(status).json({ success: false, error: message });
    }
  }

  static async me(req: Request, res: Response) {
    const ctx = req.userContext!;
    const contexts = await AuthRepository.listUserContexts(ctx.userId);
    return res.json({
      success: true,
      context: ctx,
      availableContexts: contexts,
      impersonation: !!ctx.impersonatorId,
    });
  }

  static async impersonate(req: Request, res: Response) {
    try {
      const { targetUserId, userRoleId } = req.body;
      const admin = req.userContext!;
      if (!targetUserId || !userRoleId) {
        return res.status(400).json({ success: false, error: 'targetUserId e userRoleId obrigatórios.' });
      }
      const token = await AuthService.impersonate(admin, targetUserId, userRoleId);
      const channel = admin.scope === 'global' ? 'platform' : 'client';
      try {
        const audit = new IamAuditService(dataGateway);
        await audit.logChange(admin, {
          contractId: admin.contractId ?? null,
          organizationId: admin.organizationId,
          changeType: 'IMPERSONATION_START',
          entityType: 'user_roles',
          entityId: userRoleId,
          newPayload: {
            targetUserId,
            channel,
            impersonatorUserId: admin.userId,
          },
        });
      } catch {
        /* auditoria não bloqueia emulação */
      }
      return res.status(200).json({
        success: true,
        token,
        message: 'Sessão de emulação aberta. Use em nova aba do navegador.',
        impersonatorId: admin.userId,
        channel,
      });
    } catch (error: unknown) {
      const status = (error as { httpStatus?: number }).httpStatus ?? 500;
      const message = error instanceof Error ? error.message : 'Erro interno';
      return res.status(status).json({ success: false, error: message });
    }
  }
}
