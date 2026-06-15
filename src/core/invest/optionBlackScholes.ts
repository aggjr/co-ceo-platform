export type OptionSide = 'call' | 'put';

export type BlackScholesInput = {
  side: OptionSide;
  spot: number;
  strike: number;
  valuationDate: string;
  expirationDate: string;
  riskFreeAnnual?: number;
  volatilityAnnual?: number;
};

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${to.slice(0, 10)}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function intrinsic(side: OptionSide, spot: number, strike: number): number {
  return side === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

export function blackScholesOptionPrice(input: BlackScholesInput): number | null {
  const spot = Number(input.spot);
  const strike = Number(input.strike);
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || spot <= 0 || strike <= 0) {
    return null;
  }

  const days = daysBetween(input.valuationDate, input.expirationDate);
  if (days <= 0) {
    return Math.round(intrinsic(input.side, spot, strike) * 10000) / 10000;
  }

  const t = days / 252;
  const r = Number.isFinite(input.riskFreeAnnual) ? Number(input.riskFreeAnnual) : 0.11;
  const sigma = Number.isFinite(input.volatilityAnnual) && Number(input.volatilityAnnual) > 0
    ? Number(input.volatilityAnnual)
    : 0.35;

  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const price = input.side === 'call'
    ? spot * normCdf(d1) - strike * Math.exp(-r * t) * normCdf(d2)
    : strike * Math.exp(-r * t) * normCdf(-d2) - spot * normCdf(-d1);

  return Math.round(Math.max(price, 0) * 10000) / 10000;
}
