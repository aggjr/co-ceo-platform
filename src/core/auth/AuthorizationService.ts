import { AuthRepository } from './AuthRepository';
import type { UserContext } from '../dal/types';

export class AuthorizationService {
  private static cache = new Map<string, { codes: string[]; expires: number }>();
  private static TTL_MS = 60_000;

  private static cacheKey(roleId: string): string {
    return `role:${roleId}`;
  }

  static async getPermissionCodes(roleId: string): Promise<Set<string>> {
    const key = this.cacheKey(roleId);
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) {
      return new Set(hit.codes);
    }
    const codes = await AuthRepository.getPermissionCodesForRole(roleId);
    this.cache.set(key, { codes, expires: Date.now() + this.TTL_MS });
    return new Set(codes);
  }

  static invalidateRole(roleId: string): void {
    this.cache.delete(this.cacheKey(roleId));
  }

  static async can(context: UserContext, permissionCode: string): Promise<boolean> {
    if (!context.roleId) {
      return false;
    }
    if (context.scope === 'global' && context.roleId === '00000000-0000-4000-8000-000000000001') {
      return true;
    }
    const codes = await this.getPermissionCodes(context.roleId);
    return codes.has(permissionCode);
  }

  static async assertCan(context: UserContext, permissionCode: string): Promise<void> {
    const ok = await this.can(context, permissionCode);
    if (!ok) {
      const err = new Error(`Permissão negada: ${permissionCode}`);
      (err as Error & { httpStatus: number }).httpStatus = 403;
      throw err;
    }
  }
}
