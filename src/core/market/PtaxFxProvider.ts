export async function fetchPtaxUsdBrl(date: string): Promise<number | null> {
  const [year, month, day] = date.slice(0, 10).split('-');
  if (!year || !month || !day) return null;
  const ptaxDate = `${month}-${day}-${year}`;
  const url =
    'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
    `CotacaoDolarDia(dataCotacao='${ptaxDate}')?` +
    '$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao';

  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) return null;
  const data = await resp.json() as {
    value?: Array<{
      cotacaoCompra?: number;
      cotacaoVenda?: number;
      dataHoraCotacao?: string;
    }>;
  };
  const row = data.value?.[0];
  const buy = Number(row?.cotacaoCompra);
  const sell = Number(row?.cotacaoVenda);
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0) {
    return null;
  }
  return Math.round(((buy + sell) / 2) * 100000000) / 100000000;
}
