import type { MarketDataProviderRegistry } from './MarketDataProviderRegistry';
import { BrapiMarketDataProvider } from './providers/BrapiMarketDataProvider';
import { OpcoesNetMarketDataProvider } from './providers/OpcoesNetMarketDataProvider';
import { TesouroDiretoMarketDataProvider } from './providers/TesouroDiretoMarketDataProvider';

const DEFAULT_PROVIDER_CODES = [
  'brapi',
  'opcoes_net',
  'tesouro_direto',
] as const;

/** Registra wrappers M-01 idempotente (nao sobrescreve fonte ja registrada). */
export function registerDefaultMarketDataProviders(
  registry: MarketDataProviderRegistry
): readonly string[] {
  const registered: string[] = [];
  const providers = [
    new BrapiMarketDataProvider(),
    new OpcoesNetMarketDataProvider(),
    new TesouroDiretoMarketDataProvider(),
  ];
  for (const provider of providers) {
    const code = provider.sourceCode;
    if (registry.isRegistered(code)) continue;
    registry.register(provider);
    registered.push(code);
  }
  return registered;
}

export function listDefaultProviderCodes(): readonly string[] {
  return DEFAULT_PROVIDER_CODES;
}
