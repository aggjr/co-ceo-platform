/**
 * Deriva quantidade fracionaria e PU de um valor financeiro BTG,
 * garantindo qty × PU ≈ valor (sem arredondar qty para inteiro).
 */

export type HarmonizeQuantityInput = {
  financialAmount: number;
  /** Quantidade conhecida (ex.: tabela Operacoes Tesouro). */
  quantity?: number;
  /** PM de referencia quando qty ainda nao e conhecida. */
  referenceUnitPrice?: number;
  /** Teto de qty (venda limitada a custodia). */
  maxQuantity?: number;
  /** Tolerancia em centavos entre qty×PU e o valor. Default 1 centavo. */
  toleranceCents?: number;
};

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Prefere qty “redonda” quando já está perto (ex.: 3,04 → 3), sem forçar inteiro distante. */
function preferSnappedQuantity(
  gross: number,
  qty: number,
  unitPrice: number,
  tolerance: number
): { quantity: number; unit_price: number } {
  const ordered: number[] = [];
  const nearInt = Math.round(qty);
  if (nearInt > 0 && Math.abs(qty - nearInt) < 0.06) {
    ordered.push(nearInt);
  }
  const nearTenth = Math.round(qty * 10) / 10;
  if (nearTenth > 0 && Math.abs(qty - nearTenth) < 0.006 && !ordered.includes(nearTenth)) {
    ordered.push(nearTenth);
  }
  if (qty < 1 && nearTenth > 0 && Math.abs(qty - nearTenth) < 0.04 && !ordered.includes(nearTenth)) {
    ordered.unshift(nearTenth);
  }
  if (qty >= 1) {
    const fl = Math.floor(qty);
    const cl = Math.ceil(qty);
    if (fl > 0 && Math.abs(fl - qty) < 0.5 && !ordered.includes(fl)) ordered.push(fl);
    if (cl > 0 && Math.abs(cl - qty) < 0.5 && cl !== fl && !ordered.includes(cl)) {
      ordered.push(cl);
    }
  }
  if (!ordered.includes(qty)) ordered.push(qty);

  for (const q of ordered) {
    const pu = roundToDecimals(gross / q, 4);
    if (Math.abs(q * pu - gross) <= tolerance) {
      return { quantity: q, unit_price: pu };
    }
  }
  return { quantity: qty, unit_price: unitPrice };
}

/**
 * Retorna qty e unit_price coerentes com o valor financeiro.
 * Aumenta casas decimais da qty (2→12) ate fechar o produto dentro da tolerancia.
 */
export function harmonizeQuantityWithFinancialAmount(
  input: HarmonizeQuantityInput
): { quantity: number; unit_price: number } | undefined {
  const gross = Math.abs(Number(input.financialAmount));
  if (!Number.isFinite(gross) || gross <= 0.005) return undefined;

  const tolerance = (input.toleranceCents ?? 1) / 100;
  const refPu = Number(input.referenceUnitPrice);
  let qty =
    input.quantity != null && input.quantity > 0
      ? input.quantity
      : refPu > 0
        ? gross / refPu
        : 0;

  if (qty <= 1e-12) return undefined;

  if (input.maxQuantity != null && input.maxQuantity >= 0) {
    qty = Math.min(qty, input.maxQuantity);
  }
  if (qty <= 1e-12) return undefined;

  for (const decimals of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
    const q = roundToDecimals(qty, decimals);
    if (q <= 0) continue;
    const pu = roundToDecimals(gross / q, 4);
    if (Math.abs(q * pu - gross) <= tolerance) {
      const explicitQty = input.quantity != null && input.quantity > 0;
      if (explicitQty) {
        return { quantity: q, unit_price: pu };
      }
      return preferSnappedQuantity(gross, q, pu, tolerance);
    }
  }

  const qFinal = roundToDecimals(qty, 12);
  const puFinal = roundToDecimals(gross / qFinal, 4);
  const explicitQty = input.quantity != null && input.quantity > 0;
  if (explicitQty) {
    return { quantity: qFinal, unit_price: puFinal };
  }
  return preferSnappedQuantity(gross, qFinal, puFinal, tolerance);
}
