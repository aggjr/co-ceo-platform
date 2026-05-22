import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../dal';
import { GatewayError } from '../dal/errors';
import type { ContractGuard } from '../module-registry';
import type { FinancialAccountRow, RegisterAccountInput } from './types';

/**
 * CRUD canonico de contas financeiras (financial_accounts).
 *
 * Toda criacao passa pelo ContractGuard para validar que a organizacao
 * contratou o source_module. Saldo nao eh mantido aqui — eh calculado
 * sobre opening_balance + financial_ledger_entries.
 */
export class FinancialAccountRegistry {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly contractGuard: ContractGuard
  ) {}

  async findById(ctx: UserContext, id: string): Promise<FinancialAccountRow | null> {
    const row = (await this.gateway.findById(ctx, 'financial_accounts', id)) as
      | FinancialAccountRow
      | null;
    return row;
  }

  async findByExternalId(
    ctx: UserContext,
    sourceModule: string,
    externalId: string
  ): Promise<FinancialAccountRow | null> {
    const rows = await this.gateway.findWhere(
      ctx,
      'financial_accounts',
      { source_module: sourceModule, external_id: externalId },
      { limit: 1 }
    );
    return (rows[0] as FinancialAccountRow | undefined) ?? null;
  }

  async findByName(
    ctx: UserContext,
    sourceModule: string,
    name: string
  ): Promise<FinancialAccountRow | null> {
    const rows = await this.gateway.findWhere(
      ctx,
      'financial_accounts',
      { source_module: sourceModule, name },
      { limit: 1 }
    );
    return (rows[0] as FinancialAccountRow | undefined) ?? null;
  }

  async listByModule(
    ctx: UserContext,
    sourceModule: string
  ): Promise<FinancialAccountRow[]> {
    const rows = await this.gateway.findWhere(ctx, 'financial_accounts', {
      source_module: sourceModule,
      status: 'active',
    });
    return rows as FinancialAccountRow[];
  }

  async register(
    ctx: UserContext,
    input: RegisterAccountInput
  ): Promise<FinancialAccountRow> {
    await this.contractGuard.assertCanUseModule(ctx, input.sourceModule);

    const existing = input.externalId
      ? await this.findByExternalId(ctx, input.sourceModule, input.externalId)
      : await this.findByName(ctx, input.sourceModule, input.name);
    if (existing) return existing;

    const id = randomUUID();
    const payload: SecurePayload = {
      id,
      source_module: input.sourceModule,
      account_type: input.accountType,
      external_id: input.externalId ?? null,
      name: input.name,
      currency: input.currency ?? 'BRL',
      opening_balance: input.openingBalance ?? 0,
      opening_date: input.openingDate ?? null,
      status: 'active',
      metadata: input.metadata ?? null,
    };
    await this.gateway.insert(ctx, 'financial_accounts', payload);
    const created = await this.findById(ctx, id);
    if (!created) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `Falha ao criar financial_accounts ${id}`,
        500
      );
    }
    return created;
  }
}
