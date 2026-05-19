import { Request, Response } from 'express';
import { CockpitReadRepository } from '../core/auth/CockpitReadRepository';
import { OrgScopeService } from '../core/auth/OrgScopeService';
import { CoCeoDataGateway } from '../core/dal';
import { FieldPolicyService } from '../core/auth/FieldPolicyService';

export class CockpitController {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  static listPlatformOrgTree = async (req: Request, res: Response) => {
    const nodes = await CockpitReadRepository.listOrgTreeForPlatform(req.userContext!);
    return res.json({ success: true, nodes, visibility: 'platform' });
  };

  static listPlatformImpersonationTargets = async (req: Request, res: Response) => {
    const { contractId, organizationId } = req.query;
    if (!contractId || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'contractId e organizationId são obrigatórios.',
      });
    }
    const targets = await CockpitReadRepository.listImpersonationTargets(
      req.userContext!,
      String(contractId),
      String(organizationId)
    );
    return res.json({ success: true, targets, visibility: 'platform' });
  };

  listMeOrgTree = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.contractId || !ctx.organizationId) {
      return res.status(400).json({ success: false, error: 'Sessão sem contrato ou organização.' });
    }
    const nodes = await CockpitReadRepository.listOrgTreeForClient(
      ctx,
      ctx.contractId,
      ctx.organizationId
    );
    return res.json({ success: true, nodes, visibility: 'client' });
  };

  listMeImpersonationTargets = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    const { organizationId } = req.query;
    if (!ctx.contractId || !ctx.organizationId || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'organizationId é obrigatório e a sessão deve ter escopo de contrato.',
      });
    }
    const targetOrgId = String(organizationId);
    try {
      await OrgScopeService.assertOrgInSubtree(ctx.organizationId, targetOrgId);
    } catch (error: unknown) {
      const status = (error as { httpStatus?: number }).httpStatus ?? 403;
      const message = error instanceof Error ? error.message : 'Fora do escopo.';
      return res.status(status).json({ success: false, error: message });
    }
    const targets = await CockpitReadRepository.listImpersonationTargets(
      ctx,
      ctx.contractId,
      targetOrgId,
      { excludeUserId: ctx.userId, excludeClientImpersonators: true }
    );
    return res.json({ success: true, targets, visibility: 'client' });
  };

  /** Visão plataforma: todos os contratos */
  static listPlatformContracts = async (req: Request, res: Response) => {
    const contracts = await CockpitReadRepository.listContractsForPlatform(req.userContext!);
    return res.json({ success: true, contracts, visibility: 'platform' });
  };

  /** IAM completo de um contrato (co-CEO) */
  static getPlatformContractIam = async (req: Request, res: Response) => {
    const snapshot = await CockpitReadRepository.getContractIamSnapshot(
      req.userContext!,
      req.params.contractId
    );
    if (!snapshot.contract) {
      return res.status(404).json({ success: false, error: 'Contrato não encontrado.' });
    }
    return res.json({ success: true, ...snapshot, visibility: 'platform' });
  };

  /** Resumo do Cockpit para o cliente logado */
  getMe = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    let storage = null;
    if (ctx.organizationId) {
      storage = await this.gateway.getOrganizationStorage(ctx, ctx.organizationId);
    }

    const userRow = await this.gateway.findById(ctx, 'users', ctx.userId);
    const orgRow = ctx.organizationId
      ? await this.gateway.findById(ctx, 'organizations', ctx.organizationId)
      : null;
    const roleRow = ctx.roleId ? await this.gateway.findById(ctx, 'roles', ctx.roleId) : null;

    return res.json({
      success: true,
      context: ctx,
      contractId: ctx.contractId,
      impersonation: !!ctx.impersonatorId,
      storage,
      user: userRow
        ? {
            email: userRow.email,
            fullName: userRow.full_name,
            preferredName: userRow.preferred_name,
            roleName: roleRow?.name ?? null,
          }
        : null,
      organizationName: orgRow?.name ?? null,
      visibility: 'client',
    });
  };

  /** Matriz para UI: permissões API + telas/botões + campos */
  getMeAccessMatrix = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.roleId) {
      return res.status(400).json({ success: false, error: 'Sessão sem papel ativo.' });
    }
    const matrix = await CockpitReadRepository.getAccessMatrixForRole(ctx, ctx.roleId);
    return res.json({
      success: true,
      ...matrix,
      visibility: 'client',
      note: 'Recursos deny sobrescrevem allow. Campos hidden não devem ser renderizados.',
    });
  };

  getMeTeam = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.contractId) {
      return res.status(400).json({ success: false, error: 'Sessão sem contrato.' });
    }
    const team = await CockpitReadRepository.listTeamForContract(ctx, ctx.contractId);
    return res.json({ success: true, team, visibility: 'client' });
  };

  getMeRoles = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.contractId) {
      return res.status(400).json({ success: false, error: 'Sessão sem contrato.' });
    }
    const snapshot = await CockpitReadRepository.getContractIamSnapshot(ctx, ctx.contractId);
    return res.json({
      success: true,
      roles: snapshot.roles,
      modules: snapshot.modules,
      recentChanges: snapshot.recentIamAudit,
      visibility: 'client',
    });
  };

  /** Módulos licenciados do contrato (menu lateral — não exige cockpit:iam:read). */
  getMeContractModules = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    if (!ctx.contractId) {
      return res.status(400).json({ success: false, error: 'Sessão sem contrato.' });
    }
    const snapshot = await CockpitReadRepository.getContractIamSnapshot(ctx, ctx.contractId);
    return res.json({
      success: true,
      modules: snapshot.modules,
      visibility: 'client',
    });
  };

  /** Exemplo: leitura de registro com máscara de campos */
  getInvestAssetMasked = async (req: Request, res: Response) => {
    const ctx = req.userContext!;
    const row = await this.gateway.findById(ctx, 'invest_assets', req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Não encontrado.' });
    }
    const filtered = await FieldPolicyService.filterRowForRead(
      ctx.roleId,
      ctx.organizationId,
      'invest_assets',
      row
    );
    return res.json({ success: true, data: filtered });
  };
}
