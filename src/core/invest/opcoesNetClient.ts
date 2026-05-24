const OPCOES_NET_BASE = 'https://opcoes.net.br';

export type OpcoesNetChainRow = unknown[];

export type OpcoesNetExpiration = {
  dt: string;
  calls: OpcoesNetChainRow[];
  puts: OpcoesNetChainRow[];
};

export type OpcoesNetChainResults = {
  expirations: OpcoesNetExpiration[];
};

type ApiEnvelope = {
  success: boolean;
  error?: unknown;
  requests?: Array<{
    type: string;
    error?: unknown;
    results?: OpcoesNetChainResults;
  }>;
};

function cacheBusterZ(): string {
  return String(Math.floor(Date.now() / 10_000));
}

function encodeRequest(index: number, type: string, params: Record<string, string | number | boolean>): string {
  let qs = `r${index}t=${encodeURIComponent(type)}`;
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === null || value === undefined) continue;
    qs += `&r${index}p.${key}=${encodeURIComponent(String(value))}`;
  }
  return qs;
}

/** GET /api/v1 — mesmo contrato do site opcoes.net.br (OptionsChain). */
export async function fetchOpcoesNetOptionsChain(
  underlyingAssetId: string,
  options?: { skip?: number; load?: number; signal?: AbortSignal }
): Promise<OpcoesNetChainResults> {
  const underlying = underlyingAssetId.trim().toUpperCase();
  if (!underlying) throw new Error('underlying_asset_id obrigatório para OptionsChain.');

  const skip = options?.skip ?? 0;
  const load = options?.load ?? 50;
  const qs = [
    `z=${cacheBusterZ()}`,
    encodeRequest(0, 'OptionsChain', {
      underlying_asset_id: underlying,
      skip,
      load,
      columns_info: false,
      underlying_quotes: false,
    }),
  ].join('&');

  const url = `${OPCOES_NET_BASE}/api/v1?${qs}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: options?.signal,
  });
  if (!res.ok) {
    throw new Error(`opcoes.net HTTP ${res.status} para ${underlying}`);
  }

  const body = (await res.json()) as ApiEnvelope;
  if (!body.success) {
    throw new Error(`opcoes.net API error para ${underlying}: ${JSON.stringify(body.error ?? body)}`);
  }

  const chainReq = body.requests?.find((r) => r.type === 'OptionsChain');
  if (chainReq?.error) {
    throw new Error(`OptionsChain error para ${underlying}: ${JSON.stringify(chainReq.error)}`);
  }
  if (!chainReq?.results?.expirations) {
    throw new Error(`OptionsChain sem expirations para ${underlying}`);
  }

  return chainReq.results;
}

/** Pagina por índice de vencimento (skip = quantidade já lida). */
export async function fetchOpcoesNetOptionsChainAll(
  underlyingAssetId: string,
  options?: { batchSize?: number; signal?: AbortSignal }
): Promise<OpcoesNetExpiration[]> {
  const batchSize = options?.batchSize ?? 50;
  const all: OpcoesNetExpiration[] = [];
  let skip = 0;

  while (true) {
    const batch = await fetchOpcoesNetOptionsChain(underlyingAssetId, {
      skip,
      load: batchSize,
      signal: options?.signal,
    });
    const expirations = batch.expirations ?? [];
    if (!expirations.length) break;
    all.push(...expirations);
    if (expirations.length < batchSize) break;
    skip += expirations.length;
  }

  return all;
}
