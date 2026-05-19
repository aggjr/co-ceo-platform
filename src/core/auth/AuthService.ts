import jwt from 'jsonwebtoken';
import { AuthRepository, UserContextOption } from './AuthRepository';
import { OrgScopeService } from './OrgScopeService';
import { PasswordService } from './PasswordService';
import { AuthorizationService } from './AuthorizationService';
import type { UserContext } from '../dal/types';

export interface JwtSessionPayload {
  userId: string;
  roleId: string;
  userRoleId: string;
  contractId: string | null;
  organizationId: string | null;
  scope: 'global' | 'node';
  impersonatorId: string | null;
  permVersion: number;
}

export class AuthService {
  private static secret(): string {
    return process.env.JWT_SECRET || 'co-ceo-super-secret-key';
  }

  static toUserContext(payload: JwtSessionPayload): UserContext {
    return {
      userId: payload.userId,
      roleId: payload.roleId,
      userRoleId: payload.userRoleId,
      contractId: payload.contractId,
      organizationId: payload.organizationId,
      impersonatorId: payload.impersonatorId,
      scope: payload.scope,
      permVersion: payload.permVersion,
    };
  }

  static signToken(payload: JwtSessionPayload, expiresIn: string = '8h'): string {
    return jwt.sign(payload, this.secret(), { expiresIn } as jwt.SignOptions);
  }

  static verifyToken(token: string): JwtSessionPayload {
    return jwt.verify(token, this.secret()) as JwtSessionPayload;
  }

  static buildPayloadFromContext(ctx: UserContextOption, userId: string, impersonatorId: string | null): JwtSessionPayload {
    if (ctx.scope === 'global' && ctx.organizationId) {
      throw new Error('Papel global não pode ter organization_id.');
    }
    if (ctx.scope === 'node' && !ctx.organizationId) {
      throw new Error('Papel de nó exige organization_id.');
    }
    return {
      userId,
      roleId: ctx.roleId,
      userRoleId: ctx.userRoleId,
      contractId: ctx.contractId,
      organizationId: ctx.organizationId,
      scope: ctx.scope,
      impersonatorId,
      permVersion: ctx.permVersion,
    };
  }

  static async login(email: string, password: string): Promise<{
    requiresContextSelection: boolean;
    contexts?: UserContextOption[];
    token?: string;
    user?: { id: string; email: string; fullName: string };
  }> {
    const user = await AuthRepository.findActiveUserByEmail(email);
    if (!user) {
      throw Object.assign(new Error('Credenciais inválidas.'), { httpStatus: 401 });
    }
    const valid = await PasswordService.verify(password, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Credenciais inválidas.'), { httpStatus: 401 });
    }

    const contexts = await AuthRepository.listUserContexts(user.id);
    if (!contexts.length) {
      throw Object.assign(new Error('Usuário sem papel ou contrato atribuído.'), { httpStatus: 403 });
    }

    const activeContext = this.resolveLoginContext(contexts);
    const token = this.signToken(this.buildPayloadFromContext(activeContext, user.id, null));
    return {
      requiresContextSelection: false,
      token,
      user: { id: user.id, email: user.email, fullName: user.full_name },
    };
  }

  /** Escolhe o papel padrão no login (sem tela extra — alinhado ao preview). */
  static resolveLoginContext(contexts: UserContextOption[]): UserContextOption {
    const unique = new Map<string, UserContextOption>();
    for (const ctx of contexts) {
      const key = `${ctx.roleId}|${ctx.scope}|${ctx.contractId ?? ''}|${ctx.organizationId ?? ''}`;
      if (!unique.has(key)) unique.set(key, ctx);
    }
    const list = [...unique.values()];
    const primaries = list.filter((c) => c.isPrimary);
    const pool = primaries.length ? primaries : list;
    return pool.find((c) => c.scope === 'global') ?? pool[0];
  }

  static async selectContext(
    userId: string,
    userRoleId: string,
    impersonatorId: string | null = null
  ): Promise<string> {
    const ctx = await AuthRepository.findUserContextById(userRoleId);
    if (!ctx) {
      throw Object.assign(new Error('Contexto inválido.'), { httpStatus: 404 });
    }
    const allowed = (await AuthRepository.listUserContexts(userId)).some(
      (c) => c.userRoleId === userRoleId
    );
    if (!allowed) {
      throw Object.assign(new Error('Contexto não pertence ao usuário.'), { httpStatus: 403 });
    }
    const expiresIn = impersonatorId ? '1h' : '8h';
    return this.signToken(this.buildPayloadFromContext(ctx, userId, impersonatorId), expiresIn);
  }

  static async impersonate(
    impersonator: UserContext,
    targetUserId: string,
    userRoleId: string
  ): Promise<string> {
    const targetCtx = await AuthRepository.findUserContextById(userRoleId);
    if (!targetCtx) {
      throw Object.assign(new Error('Contexto alvo inválido.'), { httpStatus: 404 });
    }

    const targetBelongsToUser = (await AuthRepository.listUserContexts(targetUserId)).some(
      (c) => c.userRoleId === userRoleId
    );
    if (!targetBelongsToUser) {
      throw Object.assign(new Error('Papel não pertence ao usuário alvo.'), { httpStatus: 403 });
    }

    const canPlatform = await AuthorizationService.can(impersonator, 'core:impersonate:execute');
    const canOrg = await AuthorizationService.can(impersonator, 'cockpit:impersonate:execute');

    if (!canPlatform && !canOrg) {
      throw Object.assign(new Error('Sem permissão para emular usuários.'), { httpStatus: 403 });
    }

    if (canPlatform && impersonator.scope === 'global') {
      return this.selectContext(targetUserId, userRoleId, impersonator.userId);
    }

    if (!canOrg || impersonator.scope !== 'node' || !impersonator.organizationId) {
      throw Object.assign(new Error('Emulação não permitida neste contexto.'), { httpStatus: 403 });
    }

    if (targetUserId === impersonator.userId) {
      throw Object.assign(new Error('Não é possível personificar a si mesmo.'), { httpStatus: 403 });
    }

    if (!targetCtx.organizationId) {
      throw Object.assign(new Error('Usuário alvo sem unidade de negócio.'), { httpStatus: 400 });
    }

    if (impersonator.contractId && targetCtx.contractId !== impersonator.contractId) {
      throw Object.assign(new Error('Usuário alvo fora do seu contrato.'), { httpStatus: 403 });
    }

    await OrgScopeService.assertOrgInSubtree(impersonator.organizationId, targetCtx.organizationId);

    const targetCanImpersonate = await AuthorizationService.can(
      {
        userId: targetUserId,
        roleId: targetCtx.roleId,
        userRoleId: targetCtx.userRoleId,
        contractId: targetCtx.contractId,
        organizationId: targetCtx.organizationId,
        impersonatorId: null,
        scope: 'node',
        permVersion: targetCtx.permVersion,
      },
      'cockpit:impersonate:execute'
    );
    if (targetCanImpersonate) {
      throw Object.assign(
        new Error('Não é permitido personificar outro administrador com permissão de emulação.'),
        { httpStatus: 403 }
      );
    }

    return this.selectContext(targetUserId, userRoleId, impersonator.userId);
  }
}
