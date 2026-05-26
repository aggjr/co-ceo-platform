/** Espelha regras de panorama (PUT ITM+near negativo; CALL só ITM). */

function isPutItm(spot: number, strike: number) {
  return spot < strike;
}

function isCallItm(spot: number, strike: number) {
  return spot > strike;
}

function putPanoramaNotional(strike: number, qty: number, spot: number, nearPct: number) {
  let itm = 0;
  let near = 0;
  const absNotional = Math.abs(qty) * strike;
  if (isPutItm(spot, strike)) itm = absNotional;
  else {
    const distPct = ((spot - strike) / strike) * 100;
    if (Math.abs(distPct) <= nearPct) near = absNotional;
  }
  return { itm, near, need: itm + near, signed: -(itm + near) };
}

function callPanoramaNotional(strike: number, qty: number, spot: number) {
  const absNotional = Math.abs(qty) * strike;
  return isCallItm(spot, strike) ? absNotional : 0;
}

describe('regras panorama opções', () => {
  it('PUT ITM gera necessidade de caixa (valor negativo na síntese)', () => {
    const p = putPanoramaNotional(70, 100, 65, 5);
    expect(p.need).toBe(7000);
    expect(p.signed).toBe(-7000);
  });

  it('CALL só ITM conta como geração de caixa', () => {
    expect(callPanoramaNotional(60, 200, 65)).toBe(12000);
    expect(callPanoramaNotional(70, 200, 65)).toBe(0);
  });

  it('PUT próximo (até 5%) entra na necessidade', () => {
    const spot = 72;
    const strike = 70;
    const p = putPanoramaNotional(strike, 100, spot, 5);
    expect(p.itm).toBe(0);
    expect(p.near).toBe(7000);
    expect(p.signed).toBe(-7000);
  });
});

describe('separação caixa / RF / CDB', () => {
  it('CDB não entra no bucket renda fixa', () => {
    const items = [
      { ticker: 'LFT-20310301', mv: 100_000 },
      { ticker: 'CDB-XYZ', mv: 50_000 },
    ];
    let rf = 0;
    let cdb = 0;
    for (const i of items) {
      if (i.ticker.startsWith('CDB-')) cdb += i.mv;
      else rf += i.mv;
    }
    expect(rf).toBe(100_000);
    expect(cdb).toBe(50_000);
  });
});
