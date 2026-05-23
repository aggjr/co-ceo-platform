/**
 * Resolve o manifesto de UI (menu + textos) para um contexto de usuario,
 * aplicando IAM (allowed resource_keys), modulos licenciados e overrides
 * por organizacao. Tudo via CoCeoDataGateway.
 */
import { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal/types';
import { CockpitReadRepository } from '../auth/CockpitReadRepository';

const DEFAULT_LOCALE = 'pt-BR';

interface RawMenuNode {
  id: string;
  code: string;
  parent_id: string | null;
  module_code: string;
  path: string | null;
  icon: string | null;
  order_index: number;
  text_key: string;
  access_resource_key: string | null;
  visibility: 'all' | 'platform_only' | 'client_only';
}

interface RawText {
  text_key: string;
  kind: string;
  module_code: string | null;
  text: string;
  is_overridden: 0 | 1 | boolean;
}

export interface MenuItemDto {
  code: string;
  label: string;
  path: string;
  textKey: string;
  resourceKey: string | null;
  icon: string | null;
}

export interface MenuModuleDto {
  id: string;
  code: string;
  label: string;
  moduleCode: string;
  textKey: string;
  items: MenuItemDto[];
}

export interface UiManifest {
  locale: string;
  version: string;
  scope: 'global' | 'node';
  menu: MenuModuleDto[];
  texts: Record<string, string>;
  overriddenKeys: string[];
}

export class UiManifestService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async build(ctx: UserContext, locale: string = DEFAULT_LOCALE): Promise<UiManifest> {
    const isGlobal = ctx.scope === 'global';
    const orgId = ctx.organizationId ?? '__none__';

    const [nodesRows, textRows, versionRows] = await Promise.all([
      this.gateway.readQuery(ctx, 'ui_menu_nodes_active'),
      this.gateway.readQuery(ctx, 'ui_texts_resolved_for_org', [orgId, locale]),
      this.gateway.readQuery(ctx, 'ui_catalog_version', [orgId]),
    ]);

    const nodes = nodesRows as unknown as RawMenuNode[];
    const texts = textRows as unknown as RawText[];

    const textMap: Record<string, string> = {};
    const overridden: string[] = [];
    for (const t of texts) {
      textMap[t.text_key] = t.text;
      if (t.is_overridden === 1 || t.is_overridden === true) {
        overridden.push(t.text_key);
      }
    }

    let allowed: Set<string> | null = null;
    let licensed: Set<string> | null = null;
    if (!isGlobal) {
      allowed = new Set<string>();
      licensed = new Set<string>(['CORE']);
      if (ctx.roleId) {
        const matrix = await CockpitReadRepository.getAccessMatrixForRole(ctx, ctx.roleId);
        for (const r of matrix.resources) {
          if (r.effect === 'allow') allowed.add(r.key);
        }
      }
      if (ctx.contractId) {
        const snapshot = await CockpitReadRepository.getContractIamSnapshot(
          ctx,
          ctx.contractId
        );
        for (const m of snapshot.modules) {
          const code = (m.module_code as string | undefined) ?? null;
          const status = (m.status as string | undefined) ?? null;
          if (code && status !== 'inactive') licensed.add(code);
        }
      }
      ensureInvestFromScreens(licensed, allowed);
    }

    const menu = buildMenuTree(nodes, textMap, {
      isGlobal,
      allowed,
      licensed,
    });

    const version = buildVersion(versionRows[0] as Record<string, unknown> | undefined);

    return {
      locale,
      version,
      scope: ctx.scope,
      menu,
      texts: textMap,
      overriddenKeys: overridden,
    };
  }
}

function buildVersion(row: Record<string, unknown> | undefined): string {
  if (!row) return '0';
  const parts = [row.catalog_at, row.menu_at, row.overrides_at]
    .map((v) => (v instanceof Date ? v.toISOString() : String(v ?? '')))
    .join('|');
  return parts;
}

function ensureInvestFromScreens(licensed: Set<string>, allowed: Set<string>): void {
  if (licensed.has('INVEST')) return;
  for (const key of allowed) {
    if (key.startsWith('screen.invest.')) {
      licensed.add('INVEST');
      return;
    }
  }
}

function buildMenuTree(
  nodes: RawMenuNode[],
  textMap: Record<string, string>,
  filters: {
    isGlobal: boolean;
    allowed: Set<string> | null;
    licensed: Set<string> | null;
  }
): MenuModuleDto[] {
  const roots = nodes.filter((n) => n.parent_id === null);
  const childrenByParent = new Map<string, RawMenuNode[]>();
  for (const n of nodes) {
    if (n.parent_id) {
      const arr = childrenByParent.get(n.parent_id) ?? [];
      arr.push(n);
      childrenByParent.set(n.parent_id, arr);
    }
  }

  const out: MenuModuleDto[] = [];
  for (const root of roots) {
    if (!isNodeVisibleForScope(root, filters.isGlobal)) continue;
    if (
      !filters.isGlobal &&
      filters.licensed &&
      !filters.licensed.has(root.module_code)
    ) {
      continue;
    }

    const items: MenuItemDto[] = [];
    const children = (childrenByParent.get(root.id) ?? []).sort(
      (a, b) => a.order_index - b.order_index
    );

    for (const child of children) {
      if (!isNodeVisibleForScope(child, filters.isGlobal)) continue;
      if (!child.path) continue;
      if (
        !filters.isGlobal &&
        filters.allowed &&
        child.access_resource_key &&
        !filters.allowed.has(child.access_resource_key)
      ) {
        continue;
      }

      items.push({
        code: child.code,
        label: textMap[child.text_key] ?? child.code,
        path: child.path,
        textKey: child.text_key,
        resourceKey: child.access_resource_key,
        icon: child.icon,
      });
    }

    if (!items.length) continue;

    out.push({
      id: root.code,
      code: root.code,
      label: textMap[root.text_key] ?? root.code,
      moduleCode: root.module_code,
      textKey: root.text_key,
      items,
    });
  }

  return out.sort((a, b) => {
    const ai = nodes.find((n) => n.code === a.code)?.order_index ?? 0;
    const bi = nodes.find((n) => n.code === b.code)?.order_index ?? 0;
    return ai - bi;
  });
}

function isNodeVisibleForScope(node: RawMenuNode, isGlobal: boolean): boolean {
  if (node.visibility === 'all') return true;
  if (node.visibility === 'platform_only') return isGlobal;
  if (node.visibility === 'client_only') return !isGlobal;
  return true;
}
