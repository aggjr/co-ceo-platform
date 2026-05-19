import { CoCeoDataGateway } from '../dal/CoCeoDataGateway';
import type { UserContext } from '../dal/types';
import { SYSTEM_INSTALLER_USER_ID } from '../dal/types';
const installerContext = (): UserContext => ({
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: null,
  impersonatorId: null,
  scope: 'global',
});

export class IamAuditService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async logChange(
    actor: UserContext,
    input: {
      contractId?: string | null;
      organizationId?: string | null;
      changeType: string;
      entityType: string;
      entityId: string;
      oldPayload?: Record<string, unknown> | null;
      newPayload?: Record<string, unknown> | null;
    }
  ): Promise<void> {
    await this.gateway.insert(installerContext(), 'iam_config_audit', {
      contract_id: input.contractId ?? null,
      organization_id: input.organizationId ?? null,
      actor_user_id: actor.userId,
      impersonator_user_id: actor.impersonatorId,
      change_type: input.changeType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      old_payload: input.oldPayload ?? null,
      new_payload: input.newPayload ?? null,
    });
  }
}
