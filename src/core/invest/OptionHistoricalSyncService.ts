import type { CoCeoDataGateway, UserContext } from '../dal';
import { isOptionTicker } from './assetClassifier';
import { authBootstrapContext } from '../auth/authBootstrapContext';

export class OptionHistoricalSyncService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async syncMissingOptions(ctx: UserContext): Promise<number> {
    if (!ctx.organizationId) return 0;
    
    // 1. Encontra todas as opções em custódia (da organization atual)
    const rows = await this.gateway.readQuery(
      ctx,
      'invest_open_option_tickers_for_org',
      [ctx.organizationId]
    );
    
    const optionTickers = new Set<string>();
    for (const r of rows) {
      const ticker = String(r.ticker ?? '').toUpperCase();
      if (ticker && isOptionTicker(ticker)) {
        optionTickers.add(ticker);
      }
    }
    if (optionTickers.size === 0) return 0;

    let updated = 0;
    const globalCtx = authBootstrapContext();

    for (const ticker of optionTickers) {
      // 2. Verifica se a opção já foi pesquisada (invest_options_fetch_cache)
      // Como a tabela cacheia por data, verificamos se existe *alguma* entrada NOT_FOUND
      // ou se há pelo menos um registro com data recente. Para simplificar, buscamos
      // qualquer registro para o ticker com status NOT_FOUND, indicando que a API não possui a série.
      let cacheCheck: Record<string, unknown>[] = [];
      try {
        cacheCheck = await this.gateway.findWhere(
          globalCtx,
          'invest_options_fetch_cache',
          { ticker, status: 'NOT_FOUND' }
        );
      } catch (err: any) {
        if (err?.code !== 'ER_NO_SUCH_TABLE' && !String(err?.message || '').includes("doesn't exist")) {
          throw err;
        }
      }
      
      if (cacheCheck.length > 0) {
        continue; // Já pesquisamos em todos os lugares e não existe. Pula direto para interpolação.
      }

      // 3. Tenta buscar da API (ex: Brapi, Opcoes.net, StatusInvest)
      // Como no momento os endpoints de opções requerem token Pro ou raspagem pesada,
      // implementamos o hook que tenta, falha, e registra no cache.
      try {
        const token = process.env.BRAPI_TOKEN || '';
        const url = `https://brapi.dev/api/v2/options/historical?ticker=${ticker}&token=${token}`;
        const res = await fetch(url);
        const json = await res.json();
        
        if (json.error || !json.results) {
          // Marca no cache como não encontrado, para nunca mais pesquisar (acelera o sistema)
          await this.gateway.insert(
            globalCtx,
            'invest_options_fetch_cache',
            {
              ticker,
              quote_date: new Date().toISOString().slice(0, 10),
              fetch_date: new Date().toISOString().slice(0, 10),
              status: 'NOT_FOUND',
              source: 'brapi',
              source_system: 'brapi'
            }
          );
        } else {
          // Se encontrou dados, podemos salvar em market_quotes_daily!
          // (Implementação futura quando o endpoint for liberado)
        }
      } catch (err) {
        // Ignora erros de rede momentâneos, não marcamos como NOT_FOUND para tentar depois.
      }
    }
    
    return updated;
  }
}
