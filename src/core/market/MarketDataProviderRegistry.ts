import {
  compareMarketDataConfidence,
  isTenantMarketField,
  type MarketDataConfidence,
  type MarketDataFetchOptions,
  type MarketDataFetchReport,
  type MarketDataProvider,
  type MarketDataRequest,
  type MarketDataResult,
  type MarketDataSourceFailure,
  type CanonicalMarketField,
  MARKET_DATA_CONFIDENCE_RANK,
  providerSupportsField,
} from './types';

export class MarketDataProviderNotRegisteredError extends Error {
  constructor(public readonly sourceCode: string) {
    super(`Provider de market data não registrado: ${sourceCode}`);
    this.name = 'MarketDataProviderNotRegisteredError';
  }
}

export class MarketDataProviderDisabledError extends Error {
  constructor(public readonly sourceCode: string) {
    super(`Provider de market data desabilitado: ${sourceCode}`);
    this.name = 'MarketDataProviderDisabledError';
  }
}

type RegisteredProvider = {
  provider: MarketDataProvider;
  enabled: boolean;
};

/**
 * Registry único de fontes de market data (A-01).
 * Implementações concretas (brapi, opções.net, Tesouro) entram em M-02+.
 */
export class MarketDataProviderRegistry {
  private readonly providers = new Map<string, RegisteredProvider>();

  register(provider: MarketDataProvider, options?: { enabled?: boolean }): void {
    const enabled = options?.enabled !== false;
    this.providers.set(provider.sourceCode, { provider, enabled });
  }

  unregister(sourceCode: string): void {
    this.providers.delete(sourceCode);
  }

  resolve(sourceCode: string): MarketDataProvider {
    const entry = this.providers.get(sourceCode);
    if (!entry) {
      throw new MarketDataProviderNotRegisteredError(sourceCode);
    }
    if (!entry.enabled) {
      throw new MarketDataProviderDisabledError(sourceCode);
    }
    return entry.provider;
  }

  tryResolve(sourceCode: string): MarketDataProvider | null {
    const entry = this.providers.get(sourceCode);
    if (!entry || !entry.enabled) return null;
    return entry.provider;
  }

  isRegistered(sourceCode: string): boolean {
    return this.providers.has(sourceCode);
  }

  isEnabled(sourceCode: string): boolean {
    return this.providers.get(sourceCode)?.enabled === true;
  }

  setEnabled(sourceCode: string, enabled: boolean): void {
    const entry = this.providers.get(sourceCode);
    if (!entry) {
      throw new MarketDataProviderNotRegisteredError(sourceCode);
    }
    entry.enabled = enabled;
  }

  listSourceCodes(): string[] {
    return [...this.providers.keys()].sort();
  }

  listEnabledSourceCodes(): string[] {
    return [...this.providers.entries()]
      .filter(([, entry]) => entry.enabled)
      .map(([code]) => code)
      .sort();
  }

  /** Campos que a fonte declara suportar para a subcategoria (via capabilities). */
  fieldsForSource(sourceCode: string, assetSubcategory: string): CanonicalMarketField[] {
    const provider = this.tryResolve(sourceCode);
    if (!provider) return [];
    const out = new Set<CanonicalMarketField>();
    for (const cap of provider.capabilities) {
      if (
        cap.assetSubcategories.includes(assetSubcategory) ||
        cap.assetSubcategories.includes('*')
      ) {
        for (const field of cap.fields) out.add(field);
      }
    }
    return [...out];
  }

  /**
   * Busca campos seguindo precedência do catálogo.
   * Falhas por fonte são acumuladas; refresh parcial é permitido.
   */
  async fetchWithPrecedence(
    request: MarketDataRequest,
    precedence: string[],
    options?: MarketDataFetchOptions
  ): Promise<MarketDataFetchReport> {
    const continueOnFailure = options?.continueOnSourceFailure !== false;
    const minRank = options?.minConfidence
      ? MARKET_DATA_CONFIDENCE_RANK[options.minConfidence]
      : 0;

    const validationFailures = this.validateRequest(request, options);
    if (validationFailures.length > 0) {
      return {
        request,
        precedence: [...precedence],
        results: [],
        resolvedByField: {},
        missingFields: [...request.fields],
        failures: validationFailures,
      };
    }

    const resolvedByField: Partial<Record<CanonicalMarketField, MarketDataResult>> = {};
    const failures: MarketDataSourceFailure[] = [];
    const fieldsNeeded = new Set(request.fields);

    for (const field of request.fields) {
      for (const sourceCode of precedence) {
        const provider = this.tryResolve(sourceCode);
        if (!provider) {
          failures.push({
            sourceCode,
            field,
            errorCode: 'provider_not_registered',
            message: 'Fonte não registrada no registry',
            retryable: false,
          });
          continue;
        }

        if (
          !providerSupportsField(provider, request.asset.assetSubcategory, field)
        ) {
          failures.push({
            sourceCode,
            field,
            errorCode: 'provider_cannot_handle',
            message: 'Provider não declara capacidade para campo/subcategoria',
            retryable: false,
          });
          continue;
        }

        const fieldRequest: MarketDataRequest = {
          ...request,
          fields: [field],
        };

        let canHandle = false;
        try {
          canHandle = await provider.canHandle(fieldRequest);
        } catch (err) {
          failures.push(this.failureFromError(sourceCode, field, err));
          if (!continueOnFailure) break;
          continue;
        }

        if (!canHandle) {
          failures.push({
            sourceCode,
            field,
            errorCode: 'provider_cannot_handle',
            message: 'canHandle retornou false',
            retryable: false,
          });
          continue;
        }

        let rows: MarketDataResult[] = [];
        try {
          rows = await provider.fetch(fieldRequest);
        } catch (err) {
          failures.push(this.failureFromError(sourceCode, field, err));
          if (!continueOnFailure) break;
          continue;
        }

        const hit = rows.find((r) => r.field === field && r.value != null);
        if (!hit) {
          failures.push({
            sourceCode,
            field,
            errorCode: 'no_data',
            message: 'Provider não retornou valor para o campo',
            retryable: true,
          });
          continue;
        }

        if (MARKET_DATA_CONFIDENCE_RANK[hit.confidence] < minRank) {
          failures.push({
            sourceCode,
            field,
            errorCode: 'no_data',
            message: 'Confiança abaixo do mínimo configurado',
            retryable: false,
          });
          continue;
        }

        const existing = resolvedByField[field];
        if (
          !existing ||
          compareMarketDataConfidence(hit.confidence, existing.confidence) > 0
        ) {
          resolvedByField[field] = hit;
        }
        break;
      }
    }

    const results = Object.values(resolvedByField) as MarketDataResult[];
    const missingFields = [...fieldsNeeded].filter((f) => !resolvedByField[f]);

    return {
      request,
      precedence: [...precedence],
      results,
      resolvedByField,
      missingFields,
      failures,
    };
  }

  private validateRequest(
    request: MarketDataRequest,
    options?: MarketDataFetchOptions
  ): MarketDataSourceFailure[] {
    const failures: MarketDataSourceFailure[] = [];
    const requireTenant = options?.requireTenantForTenantFields !== false;

    if (!request.asOfDate?.slice(0, 10)) {
      for (const field of request.fields) {
        failures.push({
          sourceCode: '_registry',
          field,
          errorCode: 'invalid_request',
          message: 'asOfDate obrigatório',
          retryable: false,
        });
      }
      return failures;
    }

    if (!request.asset?.ticker?.trim()) {
      for (const field of request.fields) {
        failures.push({
          sourceCode: '_registry',
          field,
          errorCode: 'invalid_request',
          message: 'asset.ticker obrigatório',
          retryable: false,
        });
      }
      return failures;
    }

    if (requireTenant) {
      for (const field of request.fields) {
        if (isTenantMarketField(field) && !request.tenant?.organizationId?.trim()) {
          failures.push({
            sourceCode: '_registry',
            field,
            errorCode: 'invalid_request',
            message: 'Campo tenant exige request.tenant.organizationId',
            retryable: false,
          });
        }
      }
    }

    return failures;
  }

  private failureFromError(
    sourceCode: string,
    field: CanonicalMarketField,
    err: unknown
  ): MarketDataSourceFailure {
    const message = err instanceof Error ? err.message : String(err);
    const retryable =
      message.toLowerCase().includes('rate') ||
      message.toLowerCase().includes('timeout') ||
      message.toLowerCase().includes('429');
    return {
      sourceCode,
      field,
      errorCode: retryable ? 'rate_limited' : 'fetch_failed',
      message,
      retryable,
    };
  }
}

/** Registry vazio — instância compartilhada preenchida em bootstrap (M-01). */
export const marketDataProviderRegistry = new MarketDataProviderRegistry();
