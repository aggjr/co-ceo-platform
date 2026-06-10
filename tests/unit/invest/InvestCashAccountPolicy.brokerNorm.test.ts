/**
 * Testes descendentes gerados a partir de erros de produção e falhas de suite.
 *
 * Filosofia: cada erro encontrado gera uma família de casos-filhos cobrindo
 * as fronteiras adjacentes ao ponto de falha original.
 *
 * Erros-raiz desta geração:
 *  E1 – findWhere({}) → EMPTY_PAYLOAD (DAL rejeita filtros vazios)
 *  E2 – readQuery is not a function (mock parcial sem readQuery)
 *  E3 – "BTG Pactual" não normalizado → INVEST_CASH_ACCOUNT_POLICY_NOT_FOUND
 *  E4 – is_default_for_currency:1 mascara falha de broker desconhecido
 */

import { InvestCashAccountPolicy } from '../../../src/core/invest/InvestCashAccountPolicy';
import { InMemoryGateway } from '../core/business-events/inMemoryGateway';
import type { UserContext } from '../../../src/core/dal/types';
import { SYSTEM_INSTALLER_USER_ID } from '../../../src/core/dal/types';

// ── helpers ────────────────────────────────────────────────────────────────

const GLOBAL_CTX: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: null,
  impersonatorId: null,
  scope: 'global',
};

const ORG_CTX: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: 'org-norm-test',
  impersonatorId: null,
  scope: 'node',
};

const MISSING_SCHEMA_ERR = { code: 'ER_NO_SUCH_TABLE', errno: 1146 };

async function buildGatewayWithAliases(
  aliases: Array<{ alias_name: string; broker_code: string }>
): Promise<InMemoryGateway> {
  const gw = new InMemoryGateway();
  for (const a of aliases) {
    await gw.insert(GLOBAL_CTX, 'invest_broker_aliases', {
      id: `alias-${a.alias_name.replace(/\s+/g, '-').toLowerCase()}`,
      ...a,
    });
  }
  return gw;
}

async function seedPolicy(
  gw: InMemoryGateway,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await gw.insert(ORG_CTX, 'invest_cash_account_policies', {
    id: 'policy-btg-brl',
    broker_code: 'BTG',
    currency_code: 'BRL',
    cash_ticker: 'CAIXA-BTG',
    cash_name: 'Conta BTG',
    financial_account_type: 'brokerage',
    financial_account_external_id: 'BTG-BRL',
    is_default_for_currency: 0, // 0: exige broker_code exato, sem atalho
    is_active: 1,
    valid_from: '1900-01-01',
    ...overrides,
  });
}

// ── E1-filhos: borda da DAL ────────────────────────────────────────────────

describe('E1-filhos: DAL — readQuery vs findWhere', () => {
  it('InMemoryGateway.readQuery([]) retorna [] para tabela vazia (nao lanca)', async () => {
    const gw = new InMemoryGateway();
    const rows = await gw.readQuery(GLOBAL_CTX, 'invest_broker_aliases_all', []);
    expect(rows).toEqual([]);
  });

  it('InMemoryGateway.findWhere com filtros vazios {} retorna todos os registros da org', async () => {
    const gw = new InMemoryGateway();
    await gw.insert(ORG_CTX, 'invest_broker_aliases', {
      id: 'a1', alias_name: 'BTG PACTUAL', broker_code: 'BTG',
    });
    // findWhere no InMemoryGateway aceita {}, a DAL real que rejeita
    const rows = await gw.findWhere(ORG_CTX, 'invest_broker_aliases', {});
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ── E2-filhos: mock parcial ────────────────────────────────────────────────

describe('E2-filhos: mock parcial sem readQuery', () => {
  it('mock com apenas findWhere lanca TypeError em loadBrokerAliases (comportamento conhecido)', async () => {
    const partialMock = {
      findWhere: jest.fn().mockResolvedValue([]),
      // readQuery ausente propositalmente
    };
    const policy = new InvestCashAccountPolicy(partialMock as any);
    // Deve lançar porque readQuery não existe — não deve silenciar
    await expect(
      policy.resolve(ORG_CTX, { brokerCode: 'BTG', currencyCode: 'BRL' })
    ).rejects.toThrow();
  });

  it('mock com readQuery => ER_NO_SUCH_TABLE degrada graciosamente para alias vazio', async () => {
    const gracefulMock = {
      findWhere: jest.fn().mockResolvedValue([
        {
          id: 'p1', organization_id: 'org-norm-test',
          broker_code: 'BTG', currency_code: 'BRL',
          cash_ticker: 'CAIXA-BTG', cash_name: 'BTG',
          financial_account_type: 'brokerage',
          financial_account_external_id: 'BTG',
          is_default_for_currency: 0, is_active: 1,
          valid_from: '1900-01-01', valid_to: null, priority: 0,
          source_system: null,
        },
      ]),
      readQuery: jest.fn().mockRejectedValue(MISSING_SCHEMA_ERR),
    };
    const policy = new InvestCashAccountPolicy(gracefulMock as any);
    // Sem aliases → broker_code passado como-está → 'BTG' → encontra policy
    const result = await policy.resolve(ORG_CTX, { brokerCode: 'BTG', currencyCode: 'BRL' });
    expect(result.cashTicker).toBe('CAIXA-BTG');
  });

  it('mock com readQuery => erro generico (nao schema) relanca o erro', async () => {
    const hardFailMock = {
      findWhere: jest.fn().mockResolvedValue([]),
      readQuery: jest.fn().mockRejectedValue(new Error('CONNECTION_REFUSED')),
    };
    const policy = new InvestCashAccountPolicy(hardFailMock as any);
    await expect(
      policy.resolve(ORG_CTX, { brokerCode: 'BTG', currencyCode: 'BRL' })
    ).rejects.toThrow('CONNECTION_REFUSED');
  });
});

// ── E3-filhos: matriz de variações de broker_code ─────────────────────────

describe('E3-filhos: normalização broker — matriz de variações', () => {
  let gw: InMemoryGateway;
  let policy: InvestCashAccountPolicy;

  beforeEach(async () => {
    gw = await buildGatewayWithAliases([
      { alias_name: 'BTG PACTUAL', broker_code: 'BTG' },
      { alias_name: 'BTG', broker_code: 'BTG' },
      { alias_name: 'XP INVESTIMENTOS', broker_code: 'XP' },
      { alias_name: 'XP', broker_code: 'XP' },
    ]);
    await seedPolicy(gw); // BTG/BRL, is_default_for_currency: 0
    policy = new InvestCashAccountPolicy(gw as any);
  });

  // Variações que DEVEM normalizar para BTG (estão na tabela)
  const shouldNormalize = [
    'BTG Pactual',     // caso original de produção
    'BTG PACTUAL',     // maiúsculo
    'btg pactual',     // minúsculo
    '  BTG Pactual  ', // espaços externos
    'BTG',             // canônico direto
    'btg',             // canônico minúsculo
  ];

  test.each(shouldNormalize)(
    'broker "%s" normaliza para BTG e resolve policy',
    async (brokerInput) => {
      const result = await policy.resolve(ORG_CTX, {
        brokerCode: brokerInput,
        currencyCode: 'BRL',
      });
      expect(result.brokerCode).toBe('BTG');
      expect(result.cashTicker).toBe('CAIXA-BTG');
    }
  );

  // Variações que NÃO estão na tabela → passam como-estão → policy não encontrada
  const shouldFail = [
    'BTG-PACTUAL',           // hífen em vez de espaço
    'BTG\tPactual',          // tab
    'Banco BTG',             // prefixo diferente
    'CORRETORA_X',           // completamente desconhecida
  ];

  test.each(shouldFail)(
    'broker "%s" sem alias lança INVEST_CASH_ACCOUNT_POLICY_NOT_FOUND',
    async (brokerInput) => {
      await expect(
        policy.resolve(ORG_CTX, { brokerCode: brokerInput, currencyCode: 'BRL' })
      ).rejects.toThrow(/Nenhuma policy de caixa encontrada/);
    }
  );
});

// ── E4-filhos: is_default_for_currency vs broker_code ─────────────────────

describe('E4-filhos: is_default_for_currency não deve mascarar broker errado', () => {
  let gw: InMemoryGateway;
  let policy: InvestCashAccountPolicy;

  beforeEach(async () => {
    gw = await buildGatewayWithAliases([
      { alias_name: 'BTG', broker_code: 'BTG' },
    ]);
    policy = new InvestCashAccountPolicy(gw as any);
  });

  it('is_default_for_currency:1 permite que broker desconhecido resolva via moeda', async () => {
    await seedPolicy(gw, { is_default_for_currency: 1 });
    // CORRETORA_X não tem alias → passa como-está → sem match de broker_code
    // MAS is_default_for_currency:1 permite resolução via currency
    const result = await policy.resolve(ORG_CTX, {
      brokerCode: 'CORRETORA_X',
      currencyCode: 'BRL',
    });
    // Comportamento documentado: is_default_for_currency é um fallback deliberado
    expect(result.cashTicker).toBe('CAIXA-BTG');
  });

  it('is_default_for_currency:0 exige broker_code exato — broker desconhecido lanca', async () => {
    await seedPolicy(gw, { is_default_for_currency: 0 });
    await expect(
      policy.resolve(ORG_CTX, { brokerCode: 'CORRETORA_X', currencyCode: 'BRL' })
    ).rejects.toThrow(/Nenhuma policy de caixa encontrada/);
  });

  it('broker correto resolve mesmo com is_default_for_currency:0', async () => {
    await seedPolicy(gw, { is_default_for_currency: 0 });
    const result = await policy.resolve(ORG_CTX, {
      brokerCode: 'BTG',
      currencyCode: 'BRL',
    });
    expect(result.cashTicker).toBe('CAIXA-BTG');
  });

  it('currency errada com is_default_for_currency:1 ainda lanca (BRL vs USD)', async () => {
    await seedPolicy(gw, { is_default_for_currency: 1, currency_code: 'BRL' });
    await expect(
      policy.resolve(ORG_CTX, { brokerCode: 'BTG', currencyCode: 'USD' })
    ).rejects.toThrow(/Nenhuma policy de caixa encontrada/);
  });
});

// ── Cache invalidation ─────────────────────────────────────────────────────

describe('Cache de aliases é invalidado por clearCache()', () => {
  it('alias inserido apos primeira resolucao nao e visivel ate clearCache()', async () => {
    const gw = new InMemoryGateway();
    await seedPolicy(gw, { is_default_for_currency: 0 });
    const policy = new InvestCashAccountPolicy(gw as any);

    // Primeira resolução: sem aliases → broker 'BTG' passa direto → encontra policy
    await gw.insert(GLOBAL_CTX, 'invest_broker_aliases', {
      id: 'a-btg', alias_name: 'BTG', broker_code: 'BTG',
    });
    const r1 = await policy.resolve(ORG_CTX, { brokerCode: 'BTG', currencyCode: 'BRL' });
    expect(r1.cashTicker).toBe('CAIXA-BTG');

    // Insere alias novo SEM invalidar cache
    await gw.insert(GLOBAL_CTX, 'invest_broker_aliases', {
      id: 'a-btg-pactual', alias_name: 'BTG PACTUAL', broker_code: 'BTG',
    });

    // BTG Pactual ainda não resolve (cache antigo)
    await expect(
      policy.resolve(ORG_CTX, { brokerCode: 'BTG Pactual', currencyCode: 'BRL' })
    ).rejects.toThrow(/Nenhuma policy de caixa encontrada/);

    // Após clearCache(), BTG Pactual resolve corretamente
    policy.clearCache();
    const r2 = await policy.resolve(ORG_CTX, { brokerCode: 'BTG Pactual', currencyCode: 'BRL' });
    expect(r2.cashTicker).toBe('CAIXA-BTG');
  });
});
