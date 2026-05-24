import { APP_VERSION } from '../../generated/version';
import { applyUiCatalog } from '../ui/UiCatalogApplyService';
import type { Pool } from 'mysql2/promise';

export type VersionParts = { major: number; minor: number; patch: number };

export function parseAppVersion(v: string): VersionParts | null {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]! };
}

export function versionGte(a: string, b: string): boolean {
  const va = parseAppVersion(a);
  const vb = parseAppVersion(b);
  if (!va || !vb) return false;
  if (va.major !== vb.major) return va.major > vb.major;
  if (va.minor !== vb.minor) return va.minor > vb.minor;
  return va.patch >= vb.patch;
}

export function isDeployWebhookConfigured(): boolean {
  return Boolean(String(process.env.EASYPANEL_DEPLOY_WEBHOOK_URL || '').trim());
}

export async function triggerEasypanelDeployWebhook(): Promise<{
  triggered: boolean;
  webhookConfigured: boolean;
}> {
  const webhook = String(process.env.EASYPANEL_DEPLOY_WEBHOOK_URL || '').trim();
  if (!webhook) {
    return { triggered: false, webhookConfigured: false };
  }
  const res = await fetch(webhook, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Webhook EasyPanel respondeu HTTP ${res.status}`);
  }
  return { triggered: true, webhookConfigured: true };
}

export async function syncUiCatalogAfterDeploy(pool: Pool): Promise<Record<string, unknown>> {
  return applyUiCatalog(pool);
}

export function productionDeployTargetVersion(): string {
  return APP_VERSION;
}
