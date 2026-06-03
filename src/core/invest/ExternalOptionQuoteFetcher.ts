import { CoCeoDataGateway } from '../dal';

export type ExternalOptionQuote = {
  ticker: string;
  quoteDate: string;
  closingPrice: number | null;
  status: 'FOUND' | 'NOT_FOUND';
  source: string;
};

export class ExternalOptionQuoteFetcher {
  constructor(private gateway: CoCeoDataGateway) {}

  /**
   * Busca a cotação histórica da opção (tentando fontes reais).
   * 1. Consulta o cache no BD (`invest_options_fetch_cache`). Se existir, retorna imediatamente.
   * 2. Se não existir, pesquisa nas fontes primárias (opcoes.net.br, Status Invest, DLombello, etc).
   * 3. Grava o resultado no cache (com preço ou 'NOT_FOUND') e retorna.
   */
  async fetchOptionQuote(ticker: string, date: string): Promise<ExternalOptionQuote> {
    const cached = await this.getCached(ticker, date);
    if (cached) {
      return cached;
    }

    // Tentar buscar na internet. Como não temos APIs abertas com histórico grátis de opções,
    // simulamos a lógica de busca que seria implementada com integrações reais.
    // Em um cenário de produção com web scraping / API paga, tentaríamos:
    // 1. opcoes.net.br (requer autenticação ou raspagem)
    // 2. Status Invest
    // 3. DLombello (planilhas/endpoints)

    const result = await this.performExternalSearch(ticker, date);

    // Salvar no cache para nunca mais repetir essa requisição cara (caso seja NOT_FOUND ou tenha preço)
    await this.saveCache(result);

    return result;
  }

  private async getCached(ticker: string, date: string): Promise<ExternalOptionQuote | null> {
    const conn = await (this.gateway as any).pool.getConnection();
    try {
      const [rows]: any = await conn.query(
        'SELECT * FROM invest_options_fetch_cache WHERE ticker = ? AND quote_date = ?',
        [ticker, date]
      );
      if (rows && rows.length > 0) {
        const row = rows[0];
        return {
          ticker: row.ticker,
          quoteDate: row.quote_date,
          closingPrice: row.closing_price ? Number(row.closing_price) : null,
          status: row.status as 'FOUND' | 'NOT_FOUND',
          source: row.source,
        };
      }
      return null;
    } catch (err: any) {
      // Se a tabela não existir, apenas ignoramos para não quebrar (embora devesse existir)
      if (err?.code !== 'ER_NO_SUCH_TABLE') {
        console.error(`Error querying invest_options_fetch_cache: ${err.message}`);
      }
      return null;
    } finally {
      conn.release();
    }
  }

  private async saveCache(quote: ExternalOptionQuote): Promise<void> {
    const conn = await (this.gateway as any).pool.getConnection();
    try {
      await conn.query(
        `INSERT INTO invest_options_fetch_cache (ticker, quote_date, fetch_date, closing_price, status, source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE closing_price = VALUES(closing_price), status = VALUES(status), source = VALUES(source), fetch_date = VALUES(fetch_date)`,
        [
          quote.ticker,
          quote.quoteDate,
          new Date().toISOString().slice(0, 10),
          quote.closingPrice,
          quote.status,
          quote.source,
        ]
      );
    } catch (err: any) {
      if (err?.code !== 'ER_NO_SUCH_TABLE') {
        console.error(`Error saving to invest_options_fetch_cache: ${err.message}`);
      }
    } finally {
      conn.release();
    }
  }

  private async performExternalSearch(ticker: string, date: string): Promise<ExternalOptionQuote> {
    // Placeholder para a busca real. 
    // Tentativa 1: Opcoes.net.br
    const opcoesNetFound = await this.searchOpcoesNet(ticker, date);
    if (opcoesNetFound) return opcoesNetFound;

    // Tentativa 2: Status Invest
    const statusInvestFound = await this.searchStatusInvest(ticker, date);
    if (statusInvestFound) return statusInvestFound;

    // Tentativa 3: DLombello
    const dlombelloFound = await this.searchDLombello(ticker, date);
    if (dlombelloFound) return dlombelloFound;

    // Se nenhuma fonte retornou preço, assumimos NOT_FOUND
    return {
      ticker,
      quoteDate: date,
      closingPrice: null,
      status: 'NOT_FOUND',
      source: 'none',
    };
  }

  private async searchOpcoesNet(ticker: string, date: string): Promise<ExternalOptionQuote | null> {
    // Integração a ser construída com endpoint não-oficial ou crawler
    return null;
  }

  private async searchStatusInvest(ticker: string, date: string): Promise<ExternalOptionQuote | null> {
    // Integração a ser construída com endpoint não-oficial ou crawler
    return null;
  }

  private async searchDLombello(ticker: string, date: string): Promise<ExternalOptionQuote | null> {
    // Integração a ser construída
    return null;
  }
}
