/**
 * Catalogo de UI (texto + menu) -- 100% via CoCeoDataGateway + SYSTEM_INSTALLER.
 * Reproduz no banco o menu/textos que viviam em frontend/src/navigation/menuCatalog.js.
 *
 * Convencao de chaves:
 *   menu.<module>.<slug>         label de item de menu
 *   screen.<module>.<slug>.title titulo de tela
 *   column.<module>.<slug>.<f>   cabecalho de coluna
 *   field.<module>.<slug>.<f>    label de campo de formulario
 *   value.<module>.<domain>.<c>  texto de valor de dominio (ex: PUT, CALL)
 *   button.<module>.<slug>.<a>   label de botao
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { CoCeoDataGateway } from '../../core/dal';
import { installerContext } from './lib/installerContext';
import { ensureInsert, findIdByColumn } from './lib/seedHelpers';

dotenv.config();

type TextKind =
  | 'menu_item'
  | 'screen_title'
  | 'column_label'
  | 'field_label'
  | 'value_label'
  | 'button_label';
type MenuVisibility = 'all' | 'platform_only' | 'client_only';

interface TextSeed {
  id: string;
  text_key: string;
  module_code: string | null;
  kind: TextKind;
  default_text: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

function typeMeta(
  cssClass: string,
  color: string,
  cssVar: string
): Record<string, unknown> {
  return { cssClass, color, cssVar };
}

interface MenuSeed {
  id: string;
  code: string;
  parent_code: string | null;
  module_code: string;
  path: string | null;
  icon: string | null;
  order_index: number;
  text_key: string;
  access_resource_key: string | null;
  visibility: MenuVisibility;
}

const LOCALE = 'pt-BR';

const TEXTS: TextSeed[] = [
  {
    id: '00000000-0000-4003-8000-000000000001',
    text_key: 'menu.cockpit',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Cockpit',
    description: 'Raiz do modulo Cockpit no menu',
  },
  {
    id: '00000000-0000-4003-8000-000000000002',
    text_key: 'menu.invest',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'INVEST',
    description: 'Raiz do modulo INVEST no menu',
  },
  {
    id: '00000000-0000-4003-8000-000000000010',
    text_key: 'menu.cockpit.contracts',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Contratos',
  },
  {
    id: '00000000-0000-4003-8000-000000000011',
    text_key: 'menu.cockpit.quality',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Qualidade',
  },
  {
    id: '00000000-0000-4003-8000-000000000012',
    text_key: 'menu.cockpit.platform_dashboard',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Visão global',
  },
  {
    id: '00000000-0000-4003-8000-000000000013',
    text_key: 'menu.cockpit.client_dashboard',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Minha organização',
  },
  {
    id: '00000000-0000-4003-8000-000000000014',
    text_key: 'menu.cockpit.team',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Equipe',
  },
  {
    id: '00000000-0000-4003-8000-000000000015',
    text_key: 'menu.cockpit.roles',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Papéis',
  },
  {
    id: '00000000-0000-4003-8000-000000000016',
    text_key: 'menu.cockpit.storage',
    module_code: 'CORE',
    kind: 'menu_item',
    default_text: 'Armazenamento',
  },
  {
    id: '00000000-0000-4003-8000-000000000020',
    text_key: 'menu.invest.dashboard',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Resultado histórico',
  },
  {
    id: '00000000-0000-4003-8000-000000000021',
    text_key: 'menu.invest.portfolio',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Ações/FIIs',
  },
  {
    id: '00000000-0000-4003-8000-000000000022',
    text_key: 'menu.invest.options',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Opções',
  },
  {
    id: '00000000-0000-4003-8000-000000000023',
    text_key: 'menu.invest.fixed_income',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Títulos, RF e CDB',
  },
  {
    id: '00000000-0000-4003-8000-000000000024',
    text_key: 'menu.invest.stock_gain',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Resultados por ação',
  },
  {
    id: '00000000-0000-4003-8000-000000000025',
    text_key: 'menu.invest.historico_operacoes',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Histórico de operações',
  },
  {
    id: '00000000-0000-4003-8000-000000000026',
    text_key: 'menu.invest.extratos',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Extratos de conta',
  },

  // ── Titulos de tela ─────────────────────────────────────────────────
  {
    id: '00000000-0000-4003-8000-000000000101',
    text_key: 'screen.invest.dashboard.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Resultado histórico',
  },
  {
    id: '00000000-0000-4003-8000-000000000102',
    text_key: 'screen.invest.portfolio.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Ações/FIIs',
    description: 'Titulo da tela de custódia equities',
  },
  {
    id: '00000000-0000-4003-8000-000000000103',
    text_key: 'screen.invest.options.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Opções',
    description: 'Titulo da tela de custódia opcoes',
  },
  {
    id: '00000000-0000-4003-8000-000000000104',
    text_key: 'screen.invest.fixed_income.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Títulos, RF e CDB',
    description: 'Titulo da tela de renda fixa',
  },
  {
    id: '00000000-0000-4003-8000-000000000105',
    text_key: 'screen.invest.stock_gain.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Resultados por ação',
  },
  {
    id: '00000000-0000-4003-8000-000000000106',
    text_key: 'screen.invest.historico_operacoes.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Histórico de operações',
  },
  {
    id: '00000000-0000-4003-8000-000000000107',
    text_key: 'screen.invest.extratos.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Extratos de conta',
  },
  {
    id: '00000000-0000-4003-8000-000000000108',
    text_key: 'screen.invest.resultado.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Resultado (pivot)',
  },
  {
    id: '00000000-0000-4003-8000-000000000109',
    text_key: 'screen.invest.closed_trades.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Opções finalizadas',
  },

  // ── Colunas da tela Historico Operacoes ─────────────────────────────
  {
    id: '00000000-0000-4003-8000-000000000201',
    text_key: 'column.invest.historico_operacoes.date',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Data',
  },
  {
    id: '00000000-0000-4003-8000-000000000202',
    text_key: 'column.invest.historico_operacoes.ticker',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Ticker',
  },
  {
    id: '00000000-0000-4003-8000-000000000203',
    text_key: 'column.invest.historico_operacoes.type',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'TIPO',
  },
  {
    id: '00000000-0000-4003-8000-000000000204',
    text_key: 'column.invest.historico_operacoes.underlying',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Acao ref.',
  },
  {
    id: '00000000-0000-4003-8000-000000000205',
    text_key: 'column.invest.historico_operacoes.side',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'C/V',
  },
  {
    id: '00000000-0000-4003-8000-000000000206',
    text_key: 'column.invest.historico_operacoes.unit_price',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Valor/Premio',
    description: 'Premio para opcoes, preco unitario para acoes/RF',
  },
  {
    id: '00000000-0000-4003-8000-000000000207',
    text_key: 'column.invest.historico_operacoes.settlement_tax',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Taxa liq./CCP',
  },
  {
    id: '00000000-0000-4003-8000-000000000208',
    text_key: 'column.invest.historico_operacoes.registration_tax',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Taxa registro',
  },
  {
    id: '00000000-0000-4003-8000-000000000209',
    text_key: 'column.invest.historico_operacoes.emoluments',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Emolumentos',
  },
  {
    id: '00000000-0000-4003-8000-000000000210',
    text_key: 'column.invest.historico_operacoes.cblc_total',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Total CBLC',
  },
  {
    id: '00000000-0000-4003-8000-000000000211',
    text_key: 'column.invest.historico_operacoes.bovespa_total',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Total Bovespa',
  },
  {
    id: '00000000-0000-4003-8000-000000000212',
    text_key: 'column.invest.historico_operacoes.irrf',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'IRRF',
  },
  {
    id: '00000000-0000-4003-8000-000000000213',
    text_key: 'column.invest.historico_operacoes.gross_value',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Valor contrato',
  },
  {
    id: '00000000-0000-4003-8000-000000000214',
    text_key: 'column.invest.historico_operacoes.quantity',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Qtd',
  },
  {
    id: '00000000-0000-4003-8000-000000000215',
    text_key: 'column.invest.historico_operacoes.maturity',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Data Strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000216',
    text_key: 'column.invest.historico_operacoes.note_number',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Nr. nota',
  },
  {
    id: '00000000-0000-4003-8000-000000000217',
    text_key: 'column.invest.historico_operacoes.category',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Mercado',
  },

  // ── Valores de dominio: coluna TIPO (historico operacoes) ───────────
  {
    id: '00000000-0000-4003-8000-000000000301',
    text_key: 'value.invest.trade_type.call',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'CALL',
    metadata: typeMeta('notes-type--call', '#60a5fa', '--invest-type-call'),
  },
  {
    id: '00000000-0000-4003-8000-000000000302',
    text_key: 'value.invest.trade_type.put',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'PUT',
    metadata: typeMeta('notes-type--put', '#f97316', '--invest-type-put'),
  },
  {
    id: '00000000-0000-4003-8000-000000000303',
    text_key: 'value.invest.trade_type.exec',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'EXEC',
    metadata: typeMeta('notes-type--exec', '#fbbf24', '--invest-type-exec'),
  },
  {
    id: '00000000-0000-4003-8000-000000000304',
    text_key: 'value.invest.trade_type.btc',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'BTC',
    metadata: typeMeta('notes-type--btc', '#94a3b8', '--invest-type-btc'),
  },
  {
    id: '00000000-0000-4003-8000-000000000305',
    text_key: 'value.invest.trade_type.lft',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'LFT',
    metadata: typeMeta('notes-type--rf', '#ec4899', '--invest-type-rf'),
  },
  {
    id: '00000000-0000-4003-8000-000000000306',
    text_key: 'value.invest.trade_type.ltn',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'LTN',
    metadata: typeMeta('notes-type--rf', '#ec4899', '--invest-type-rf'),
  },
  {
    id: '00000000-0000-4003-8000-000000000307',
    text_key: 'value.invest.trade_type.cdb',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'CDB',
    metadata: typeMeta('notes-type--rf', '#ec4899', '--invest-type-rf'),
  },
  {
    id: '00000000-0000-4003-8000-000000000308',
    text_key: 'value.invest.trade_type.ntn',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'NTN',
    metadata: typeMeta('notes-type--rf', '#ec4899', '--invest-type-rf'),
  },
  {
    id: '00000000-0000-4003-8000-000000000309',
    text_key: 'value.invest.trade_type.stock',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'AÇÃO',
    metadata: typeMeta('notes-type--stock', '#f97316', '--invest-type-stock'),
  },
  {
    id: '00000000-0000-4003-8000-000000000310',
    text_key: 'value.invest.trade_type.fii',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'FII',
    metadata: typeMeta('notes-type--fii', '#a78bfa', '--invest-type-fii'),
  },
  {
    id: '00000000-0000-4003-8000-000000000311',
    text_key: 'value.invest.trade_type.bdr',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'BDR',
    metadata: typeMeta('notes-type--bdr', '#38bdf8', '--invest-type-bdr'),
  },
  {
    id: '00000000-0000-4003-8000-000000000312',
    text_key: 'value.invest.trade_type.debenture',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'DEBÊNTURE',
    metadata: typeMeta('notes-type--rf', '#ec4899', '--invest-type-rf'),
  },
];

const MENU: MenuSeed[] = [
  // Raizes (sem path, sem access_resource_key).
  {
    id: '00000000-0000-4004-8000-000000000001',
    code: 'cockpit',
    parent_code: null,
    module_code: 'CORE',
    path: null,
    icon: null,
    order_index: 10,
    text_key: 'menu.cockpit',
    access_resource_key: null,
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000002',
    code: 'invest',
    parent_code: null,
    module_code: 'INVEST',
    path: null,
    icon: null,
    order_index: 20,
    text_key: 'menu.invest',
    access_resource_key: null,
    visibility: 'all',
  },
  // Itens Cockpit.
  {
    id: '00000000-0000-4004-8000-000000000010',
    code: 'cockpit.contracts',
    parent_code: 'cockpit',
    module_code: 'CORE',
    path: '/cockpit/platform',
    icon: null,
    order_index: 10,
    text_key: 'menu.cockpit.contracts',
    access_resource_key: 'screen.cockpit.platform',
    visibility: 'platform_only',
  },
  {
    id: '00000000-0000-4004-8000-000000000011',
    code: 'cockpit.quality',
    parent_code: 'cockpit',
    module_code: 'CORE',
    path: '/cockpit/platform/quality',
    icon: null,
    order_index: 20,
    text_key: 'menu.cockpit.quality',
    access_resource_key: 'screen.cockpit.quality',
    visibility: 'platform_only',
  },
  {
    id: '00000000-0000-4004-8000-000000000012',
    code: 'cockpit.platform_dashboard',
    parent_code: 'cockpit',
    module_code: 'CORE',
    path: '/cockpit',
    icon: null,
    order_index: 30,
    text_key: 'menu.cockpit.platform_dashboard',
    access_resource_key: 'screen.cockpit.dashboard',
    visibility: 'platform_only',
  },
  {
    id: '00000000-0000-4004-8000-000000000013',
    code: 'cockpit.client_dashboard',
    parent_code: 'cockpit',
    module_code: 'CORE',
    path: '/cockpit/client',
    icon: null,
    order_index: 40,
    text_key: 'menu.cockpit.client_dashboard',
    access_resource_key: 'screen.cockpit.dashboard',
    visibility: 'client_only',
  },
  {
    id: '00000000-0000-4004-8000-000000000014',
    code: 'cockpit.team',
    parent_code: 'cockpit',
    module_code: 'CORE',
    path: '/cockpit/client/team',
    icon: null,
    order_index: 50,
    text_key: 'menu.cockpit.team',
    access_resource_key: 'screen.cockpit.team',
    visibility: 'client_only',
  },
  {
    id: '00000000-0000-4004-8000-000000000015',
    code: 'cockpit.roles',
    parent_code: 'cockpit',
    module_code: 'CORE',
    path: '/cockpit/client/roles',
    icon: null,
    order_index: 60,
    text_key: 'menu.cockpit.roles',
    access_resource_key: 'screen.cockpit.roles',
    visibility: 'client_only',
  },
  {
    id: '00000000-0000-4004-8000-000000000016',
    code: 'cockpit.storage',
    parent_code: 'cockpit',
    module_code: 'CORE',
    path: '/cockpit/client/storage',
    icon: null,
    order_index: 70,
    text_key: 'menu.cockpit.storage',
    access_resource_key: 'screen.cockpit.storage',
    visibility: 'client_only',
  },
  // Itens INVEST.
  {
    id: '00000000-0000-4004-8000-000000000020',
    code: 'invest.dashboard',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest',
    icon: null,
    order_index: 10,
    text_key: 'menu.invest.dashboard',
    access_resource_key: 'screen.invest.dashboard',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000021',
    code: 'invest.portfolio',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest/opcoes',
    icon: null,
    order_index: 20,
    text_key: 'menu.invest.portfolio',
    access_resource_key: 'screen.invest.portfolio',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000022',
    code: 'invest.options',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest/portfolio',
    icon: null,
    order_index: 30,
    text_key: 'menu.invest.options',
    access_resource_key: 'screen.invest.portfolio',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000023',
    code: 'invest.fixed_income',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest/titulos',
    icon: null,
    order_index: 40,
    text_key: 'menu.invest.fixed_income',
    access_resource_key: 'screen.invest.portfolio',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000024',
    code: 'invest.stock_gain',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest/ganhos-por-acao',
    icon: null,
    order_index: 50,
    text_key: 'menu.invest.stock_gain',
    access_resource_key: 'screen.invest.results',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000025',
    code: 'invest.historico_operacoes',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest/historico-operacoes',
    icon: null,
    order_index: 60,
    text_key: 'menu.invest.historico_operacoes',
    access_resource_key: 'screen.invest.results',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000026',
    code: 'invest.extratos',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest/extratos',
    icon: null,
    order_index: 70,
    text_key: 'menu.invest.extratos',
    access_resource_key: 'screen.invest.results',
    visibility: 'all',
  },
];

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = installerContext();

  console.log('[008] Catalogo de texto + menu via CoCeoDataGateway...');

  let textsInserted = 0;
  for (const t of TEXTS) {
    const result = await ensureInsert(
      gateway,
      ctx,
      'ui_text_catalog',
      t.id,
      {
        text_key: t.text_key,
        locale: LOCALE,
        module_code: t.module_code,
        kind: t.kind,
        default_text: t.default_text,
        description: t.description ?? null,
        metadata: t.metadata ?? null,
      },
      { entityType: 'ui_text_catalog' }
    );
    if (result === 'inserted') textsInserted++;
    else if (t.metadata) {
      const existingId = await findIdByColumn(
        gateway,
        ctx,
        'ui_text_catalog',
        'text_key',
        t.text_key
      );
      if (existingId) {
        await gateway.update(ctx, 'ui_text_catalog', existingId, {
          metadata: t.metadata,
        });
      }
    }
  }

  const codeToId = new Map<string, string>();
  for (const m of MENU) codeToId.set(m.code, m.id);

  let menuInserted = 0;
  for (const m of MENU) {
    const parentId = m.parent_code ? codeToId.get(m.parent_code) ?? null : null;
    const result = await ensureInsert(
      gateway,
      ctx,
      'ui_menu_nodes',
      m.id,
      {
        code: m.code,
        parent_id: parentId,
        module_code: m.module_code,
        path: m.path,
        icon: m.icon,
        order_index: m.order_index,
        text_key: m.text_key,
        access_resource_key: m.access_resource_key,
        visibility: m.visibility,
        is_active: true,
      },
      { entityType: 'ui_menu_nodes' }
    );
    if (result === 'inserted') menuInserted++;
    else {
      const existingId = await findIdByColumn(gateway, ctx, 'ui_menu_nodes', 'code', m.code);
      if (existingId) {
        await gateway.update(ctx, 'ui_menu_nodes', existingId, {
          path: m.path,
          text_key: m.text_key,
          order_index: m.order_index,
          access_resource_key: m.access_resource_key,
        });
      }
    }
  }

  console.log(
    `Concluido. Textos novos: ${textsInserted}/${TEXTS.length} | Itens de menu novos: ${menuInserted}/${MENU.length}`
  );
  await pool.end();
}

run().catch((err) => {
  console.error('Falha no seed UI catalog:', err);
  process.exit(1);
});
