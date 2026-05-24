/**
 * Pool de sementes do fuzzer: deduplica por payload (mesmo conjunto de entrada)
 * e limita por proporcionalidade aos endpoints, sem descarte aleatório.
 */

function payloadFingerprint(payload) {
  if (!payload || typeof payload !== 'object') return String(payload);
  const keys = Object.keys(payload).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = payload[k];
  return JSON.stringify(ordered);
}

function dedupeRecordsByPayload(records) {
  const seen = new Set();
  const out = [];
  const sorted = [...records].sort(
    (a, b) => (Number(b.fitness) || 0) - (Number(a.fitness) || 0)
  );

  for (const r of sorted) {
    if (!r?.payload || typeof r.payload !== 'object') continue;
    const key = payloadFingerprint(r.payload);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function computeSeedPoolCap(endpointCount, options = {}) {
  const minCap = options.minCap ?? 100;
  const maxCap = options.maxCap ?? 500;
  const perEndpoint = options.perEndpoint ?? 25;
  const n = Math.max(1, Number(endpointCount) || 1);
  return Math.max(minCap, Math.min(maxCap, n * perEndpoint));
}

function selectHistoricalSeeds(records, cap) {
  return dedupeRecordsByPayload(records)
    .slice(0, cap)
    .map((r) => r.payload);
}

module.exports = {
  payloadFingerprint,
  dedupeRecordsByPayload,
  computeSeedPoolCap,
  selectHistoricalSeeds,
};
