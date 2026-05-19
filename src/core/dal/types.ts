/**
 * Contexto de execução propagado do JWT (ou scripts SYSTEM_INSTALLER).
 * impersonatorId: preenchido em sessões de emulação — audit trail obrigatório.
 */
export interface UserContext {
  userId: string;
  organizationId: string | null;
  impersonatorId: string | null;
  scope: 'global' | 'node';
  /** Papel ativo na sessão (JWT) */
  roleId?: string;
  /** Linha em user_roles */
  userRoleId?: string;
  /** Contrato comercial ativo */
  contractId?: string | null;
  /** Invalida JWT quando IAM do usuário muda */
  permVersion?: number;
}

export const SYSTEM_INSTALLER_USER_ID = 'SYSTEM_INSTALLER';

export type AuditAction = 'INSERT' | 'UPDATE' | 'SOFT_DELETE' | 'DELETE';

export type PayloadValue = string | number | boolean | Date | null | object;
export type SecurePayload = Record<string, PayloadValue>;

export interface InsertResult {
  insertId: number | null;
  recordId: string;
  affectedRows: number;
}

export interface StorageCheckResult {
  allowed: boolean;
  bytesUsed: number;
  bytesLimit: number | null;
  bytesAfter: number;
}
