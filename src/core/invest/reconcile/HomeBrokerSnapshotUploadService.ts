import type { CoCeoDataGateway, UserContext } from '../../dal';
import { GatewayError } from '../../dal/errors';
import type { BtgUploadFileInput } from '../btgUploadImportService';
import { applyBrokerHoldingSnapshot } from '../applyBrokerHoldingSnapshot';
import { BrokerCustodySnapshotRepository } from '../BrokerCustodySnapshotRepository';
import { parseBrokerCustodySnapshotJson } from '../brokerCustodySnapshotImport';
import { PatrimonyMonthlyAnchorsSeedService } from '../PatrimonyMonthlyAnchorsSeedService';
import type { PatrimonyAnchorFile } from '../patrimonyAnchors';

export type HomeBrokerSnapshotUploadResult = {
  filesTotal: number;
  snapshotsImported: number;
  snapshotsApplied: number;
  anchorsUpserted: number;
  warnings: string[];
  appliedDates: string[];
};

function decodeJsonFile(file: BtgUploadFileInput): unknown {
  const raw = Buffer.from(file.contentBase64 || '', 'base64').toString('utf8').trim();
  if (!raw) {
    throw new Error('arquivo vazio');
  }
  return JSON.parse(raw);
}

function looksLikeAnchorFile(raw: unknown): raw is PatrimonyAnchorFile {
  if (!raw || typeof raw !== 'object') return false;
  const doc = raw as Record<string, unknown>;
  return Array.isArray(doc.month_ends);
}

/**
 * Importa fechamentos do home broker para a fase de homologacao.
 *
 * Aceita dois formatos JSON:
 * - snapshot detalhado de custodia (`positions[]` + `composition`)
 * - arquivo simples de ancoras mensais (`month_ends[]`)
 */
export class HomeBrokerSnapshotUploadService {
  private readonly snapshots: BrokerCustodySnapshotRepository;
  private readonly anchors: PatrimonyMonthlyAnchorsSeedService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.snapshots = new BrokerCustodySnapshotRepository(gateway);
    this.anchors = new PatrimonyMonthlyAnchorsSeedService(gateway);
  }

  async importAndApply(
    ctx: UserContext,
    files: BtgUploadFileInput[] | undefined
  ): Promise<HomeBrokerSnapshotUploadResult> {
    if (!ctx.organizationId) {
      throw new GatewayError('INVALID_CONTEXT', 'Personifique a holding antes de importar snapshots.', 400);
    }

    const result: HomeBrokerSnapshotUploadResult = {
      filesTotal: files?.length ?? 0,
      snapshotsImported: 0,
      snapshotsApplied: 0,
      anchorsUpserted: 0,
      warnings: [],
      appliedDates: [],
    };

    for (const file of files ?? []) {
      try {
        const raw = decodeJsonFile(file);
        if (looksLikeAnchorFile(raw)) {
          const seeded = await this.anchors.seedFromFile(ctx, raw);
          result.anchorsUpserted += seeded.upserted;
          continue;
        }

        const input = parseBrokerCustodySnapshotJson(raw);
        await this.snapshots.upsertFromInput(ctx, input);
        result.snapshotsImported += 1;

        const applied = await applyBrokerHoldingSnapshot(
          this.gateway,
          ctx.organizationId,
          input.referenceDate
        );
        result.snapshotsApplied += 1;
        result.appliedDates.push(applied.asOf);
        if (applied.positionsMissing.length) {
          result.warnings.push(
            `${file.name}: ${applied.positionsMissing.length} ativo(s) do snapshot sem item INVEST correspondente (${applied.positionsMissing.join(', ')})`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.warnings.push(`${file.name}: ${msg}`);
      }
    }

    return result;
  }
}
