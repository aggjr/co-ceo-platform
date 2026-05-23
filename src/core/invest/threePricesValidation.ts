import type { ThreeAvgPrices } from './portfolioThreePrices';
import type { ThreePrices } from './threePricesEngine';

export type ThreePricesValidationStatus = 'ok' | 'warn' | 'error';

export type ThreePricesValidation = {
  status: ThreePricesValidationStatus;
  codes: string[];
  messages: string[];
  /** Texto único para coluna Observação na UI. */
  observation: string;
  engineQty: number | null;
  custodyQty: number;
  engine: ThreeAvgPrices | null;
  storedExt: ThreeAvgPrices | null;
  displayed: ThreeAvgPrices;
};

const QTY_EPS = 1e-4;
const PM_ABS_TOL = 0.05;
const PM_REL_TOL = 0.002;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pmClose(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a <= 0 && b <= 0) return true;
  const diff = Math.abs(a - b);
  if (diff <= PM_ABS_TOL) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return diff / base <= PM_REL_TOL;
}

function fmtPm(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function joinObservation(codes: string[], messages: string[]): string {
  if (!messages.length) return 'OK — batido com livro e extensão';
  const head = codes.length ? `[${codes.join(', ')}]` : '';
  return `${head} ${messages.join(' · ')}`.trim();
}

export type ValidateEquityThreePricesInput = {
  ticker: string;
  custodyQty: number;
  engineSnapshot: ThreePrices | null;
  storedExt: {
    strict?: number | null;
    b3?: number | null;
    managerial?: number | null;
  } | null;
  displayed: ThreeAvgPrices;
};

/**
 * Valida os três preços exibidos (Estrito / B3 / Gerencial) contra:
 * - engine recalculado no livro (threePricesEngine)
 * - invest_position_ext (pm_estrito / pm_b3 / pm_gerencial)
 * - regras de ordenação típica (Estrito ≥ B3 ≥ Gerencial em longo com prêmios)
 */
export function validateEquityThreePrices(
  input: ValidateEquityThreePricesInput
): ThreePricesValidation {
  const codes: string[] = [];
  const messages: string[] = [];
  let status: ThreePricesValidationStatus = 'ok';

  const bump = (level: ThreePricesValidationStatus, code: string, msg: string) => {
    codes.push(code);
    messages.push(msg);
    if (level === 'error') status = 'error';
    else if (level === 'warn' && status !== 'error') status = 'warn';
  };

  const custodyQty = Number(input.custodyQty);
  const eng = input.engineSnapshot;
  const engine: ThreeAvgPrices | null = eng
    ? {
        strict: eng.estrito,
        b3: eng.b3,
        managerial: eng.gerencial,
      }
    : null;

  const storedExt: ThreeAvgPrices | null =
    input.storedExt &&
    (input.storedExt.strict != null ||
      input.storedExt.b3 != null ||
      input.storedExt.managerial != null)
      ? {
          strict: Number(input.storedExt.strict ?? 0),
          b3: Number(input.storedExt.b3 ?? 0),
          managerial: Number(input.storedExt.managerial ?? 0),
        }
      : null;

  const displayed = {
    strict: round4(Number(input.displayed.strict)),
    b3: round4(Number(input.displayed.b3)),
    managerial: round4(Number(input.displayed.managerial)),
  };

  if (Math.abs(custodyQty) < QTY_EPS) {
    return {
      status: 'ok',
      codes: [],
      messages: [],
      observation: 'Posição zerada',
      engineQty: eng?.qty ?? 0,
      custodyQty,
      engine,
      storedExt,
      displayed,
    };
  }

  if (!engine || (eng?.qty ?? 0) <= QTY_EPS) {
    bump(
      'error',
      'SEM_ENGINE',
      'Livro não gerou PM para este papel (sem lote longo no engine ou eventos ignorados)'
    );
  } else if (Math.abs((eng?.qty ?? 0) - custodyQty) > QTY_EPS) {
    bump(
      'warn',
      'QTY_DIVERGE',
      `Qty livro ${eng!.qty} ≠ custódia ${custodyQty}`
    );
  }

  for (const [label, v] of [
    ['Estrito', displayed.strict],
    ['B3', displayed.b3],
    ['Gerencial', displayed.managerial],
  ] as const) {
    if (v < 0) bump('error', 'PM_NEG', `${label} negativo na tela`);
  }

  if (engine) {
    if (!pmClose(displayed.strict, engine.strict)) {
      bump(
        'error',
        'UI_VS_ENGINE_E',
        `Tela Estrito ${fmtPm(displayed.strict)} ≠ livro ${fmtPm(engine.strict)}`
      );
    }
    if (!pmClose(displayed.b3, engine.b3)) {
      bump(
        'error',
        'UI_VS_ENGINE_B',
        `Tela B3 ${fmtPm(displayed.b3)} ≠ livro ${fmtPm(engine.b3)}`
      );
    }
    if (!pmClose(displayed.managerial, engine.managerial)) {
      bump(
        'error',
        'UI_VS_ENGINE_G',
        `Tela Ger. ${fmtPm(displayed.managerial)} ≠ livro ${fmtPm(engine.managerial)}`
      );
    }
  }

  if (storedExt && engine) {
    if (!pmClose(storedExt.strict, engine.strict)) {
      bump(
        'warn',
        'EXT_VS_ENGINE_E',
        `Ext Estrito ${fmtPm(storedExt.strict)} ≠ livro ${fmtPm(engine.strict)}`
      );
    }
    if (!pmClose(storedExt.b3, engine.b3)) {
      bump(
        'warn',
        'EXT_VS_ENGINE_B',
        `Ext B3 ${fmtPm(storedExt.b3)} ≠ livro ${fmtPm(engine.b3)}`
      );
    }
    if (!pmClose(storedExt.managerial, engine.managerial)) {
      bump(
        'warn',
        'EXT_VS_ENGINE_G',
        `Ext Ger. ${fmtPm(storedExt.managerial)} ≠ livro ${fmtPm(engine.managerial)}`
      );
    }
  } else if (!storedExt && engine && custodyQty > QTY_EPS) {
    bump(
      'warn',
      'EXT_AUSENTE',
      'invest_position_ext sem PM — tela usa só recálculo do livro'
    );
  }

  if (
    displayed.strict > 0 &&
    displayed.b3 > 0 &&
    displayed.managerial > 0 &&
    displayed.managerial > displayed.b3 + PM_ABS_TOL
  ) {
    bump(
      'warn',
      'ORDEM_G_B',
      `Gerencial (${fmtPm(displayed.managerial)}) > B3 (${fmtPm(displayed.b3)}) — revisar CALLs/PUTs no lote`
    );
  }
  if (
    displayed.strict > 0 &&
    displayed.b3 > 0 &&
    displayed.b3 > displayed.strict + PM_ABS_TOL
  ) {
    bump(
      'warn',
      'ORDEM_B_E',
      `B3 (${fmtPm(displayed.b3)}) > Estrito (${fmtPm(displayed.strict)}) — revisar exercício PUT ou custos`
    );
  }
  if (
    displayed.strict > 0 &&
    displayed.managerial > displayed.strict + PM_ABS_TOL
  ) {
    bump(
      'error',
      'ORDEM_G_E',
      `Gerencial (${fmtPm(displayed.managerial)}) > Estrito (${fmtPm(displayed.strict)})`
    );
  }

  if (displayed.strict > 0 && displayed.b3 <= 0) {
    bump('error', 'B3_ZERO', 'B3 zerado com Estrito positivo');
  }
  if (displayed.strict > 0 && displayed.managerial <= 0) {
    bump('error', 'GER_ZERO', 'Gerencial zerado com Estrito positivo');
  }

  return {
    status,
    codes,
    messages,
    observation: joinObservation(codes, messages),
    engineQty: eng?.qty ?? null,
    custodyQty,
    engine,
    storedExt,
    displayed,
  };
}
