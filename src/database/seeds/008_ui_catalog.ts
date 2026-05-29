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
  | 'button_label'
  | 'description';
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

export const TEXTS: TextSeed[] = [
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
    id: '00000000-0000-4003-8000-000000000170',
    text_key: 'menu.invest.conciliacao',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Conciliação',
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
    id: '00000000-0000-4003-8000-000000000130',
    text_key: 'menu.invest.options.table',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Tabela Excel',
  },
  {
    id: '00000000-0000-4003-8000-000000000131',
    text_key: 'menu.invest.options.cards',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Cards',
  },
  {
    id: '00000000-0000-4003-8000-000000000132',
    text_key: 'menu.invest.options.expiry',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Por vencimento',
  },
  {
    id: '00000000-0000-4003-8000-000000000133',
    text_key: 'screen.invest.options.table.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Opções — Tabela Excel',
  },
  {
    id: '00000000-0000-4003-8000-000000000134',
    text_key: 'screen.invest.options.cards.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Opções — Cards',
  },
  {
    id: '00000000-0000-4003-8000-000000000135',
    text_key: 'screen.invest.options.expiry.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Opções — Por vencimento',
  },
  {
    id: '00000000-0000-4003-8000-000000000136',
    text_key: 'filter.invest.options.all_assets',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Todas ações',
  },
  {
    id: '00000000-0000-4003-8000-000000000137',
    text_key: 'filter.invest.options.all_expiries',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Todos vencimentos',
  },
  {
    id: '00000000-0000-4003-8000-000000000138',
    text_key: 'filter.invest.options.all_types',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Call e Put',
  },
  {
    id: '00000000-0000-4003-8000-000000000139',
    text_key: 'filter.invest.options.all_distances',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Qualquer distância',
  },
  {
    id: '00000000-0000-4003-8000-000000000140',
    text_key: 'filter.invest.options.underlying',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Ação ref.',
  },
  {
    id: '00000000-0000-4003-8000-000000000141',
    text_key: 'filter.invest.options.expiry',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Data strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000142',
    text_key: 'filter.invest.options.type',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Tipo',
  },
  {
    id: '00000000-0000-4003-8000-000000000143',
    text_key: 'filter.invest.options.distance',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Distância',
  },
  {
    id: '00000000-0000-4003-8000-000000000144',
    text_key: 'filter.invest.options.type_call',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'CALL',
  },
  {
    id: '00000000-0000-4003-8000-000000000145',
    text_key: 'filter.invest.options.type_put',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'PUT',
  },
  {
    id: '00000000-0000-4003-8000-000000000146',
    text_key: 'filter.invest.options.dist_itm',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Dentro do dinheiro',
  },
  {
    id: '00000000-0000-4003-8000-000000000147',
    text_key: 'filter.invest.options.dist_near',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Perto do strike (5%)',
  },
  {
    id: '00000000-0000-4003-8000-000000000148',
    text_key: 'filter.invest.options.dist_far',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Longe do strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000149',
    text_key: 'legend.invest.options.itm',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Dentro do dinheiro',
  },
  {
    id: '00000000-0000-4003-8000-000000000150',
    text_key: 'legend.invest.options.near',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Perto do strike (até 5%)',
  },
  {
    id: '00000000-0000-4003-8000-000000000151',
    text_key: 'legend.invest.options.far',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Longe do strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000152',
    text_key: 'field.invest.options.ticker',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Ticker opção',
  },
  {
    id: '00000000-0000-4003-8000-000000000153',
    text_key: 'field.invest.options.underlying',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Ação ref.',
  },
  {
    id: '00000000-0000-4003-8000-000000000154',
    text_key: 'field.invest.options.type',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Tipo',
  },
  {
    id: '00000000-0000-4003-8000-000000000155',
    text_key: 'field.invest.options.quantity',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Quantidade',
  },
  {
    id: '00000000-0000-4003-8000-000000000156',
    text_key: 'field.invest.options.strike',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Valor strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000157',
    text_key: 'field.invest.options.premium',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Prêmio',
  },
  {
    id: '00000000-0000-4003-8000-000000000158',
    text_key: 'field.invest.options.premium_total',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Prêmio total',
  },
  {
    id: '00000000-0000-4003-8000-000000000159',
    text_key: 'field.invest.options.quote',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Cotação opção',
  },
  {
    id: '00000000-0000-4003-8000-000000000160',
    text_key: 'field.invest.options.notional',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Notional',
  },
  {
    id: '00000000-0000-4003-8000-000000000161',
    text_key: 'field.invest.options.underlying_quote',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Cotação ação',
  },
  {
    id: '00000000-0000-4003-8000-000000000162',
    text_key: 'field.invest.options.strike_distance',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Dist. à ação',
  },
  {
    id: '00000000-0000-4003-8000-000000000163',
    text_key: 'field.invest.options.expiry',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Data strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000164',
    text_key: 'field.invest.options.result',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Resultado (R$)',
  },
  {
    id: '00000000-0000-4003-8000-000000000165',
    text_key: 'field.invest.options.result_pct',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: '% resultado',
  },
  {
    id: '00000000-0000-4003-8000-000000000166',
    text_key: 'screen.invest.options.cards.empty',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Nenhuma opção vigente para os filtros selecionados.',
  },
  {
    id: '00000000-0000-4003-8000-000000000167',
    text_key: 'screen.invest.options.cards.summary',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Exibindo {shown} de {total} posição(ões) vigentes.',
  },
  {
    id: '00000000-0000-4003-8000-000000000168',
    text_key: 'screen.invest.options.expiry.empty',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Nenhuma opção vigente para os filtros selecionados.',
  },
  {
    id: '00000000-0000-4003-8000-000000000169',
    text_key: 'screen.invest.options.expiry.count_itm',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: '{n} dentro do dinheiro',
  },
  {
    id: '00000000-0000-4003-8000-000000000170',
    text_key: 'screen.invest.options.expiry.count_positions',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: '{n} posição(ões)',
  },
  {
    id: '00000000-0000-4003-8000-000000000171',
    text_key: 'column.invest.options.expiry_ticker',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Ticker',
  },
  {
    id: '00000000-0000-4003-8000-000000000172',
    text_key: 'column.invest.options.expiry_type',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Tipo',
  },
  {
    id: '00000000-0000-4003-8000-000000000173',
    text_key: 'column.invest.options.expiry_qty',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Qtd',
  },
  {
    id: '00000000-0000-4003-8000-000000000174',
    text_key: 'column.invest.options.expiry_strike',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Valor strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000175',
    text_key: 'column.invest.options.expiry_distance',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Dist. à ação',
  },
  {
    id: '00000000-0000-4003-8000-000000000176',
    text_key: 'column.invest.options.expiry_result',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Resultado',
  },
  {
    id: '00000000-0000-4003-8000-000000000180',
    text_key: 'action.platform.ui_catalog_apply',
    module_code: 'CORE',
    kind: 'button_label',
    default_text: 'Sincronizar DE-PARA UI',
    description: 'Botão temporário no header — sincronizar catálogo de textos',
  },
  {
    id: '00000000-0000-4003-8000-000000000181',
    text_key: 'action.platform.ui_catalog_apply.hint',
    module_code: 'CORE',
    kind: 'field_label',
    default_text:
      'Grava textos curtos do catálogo (Opções Cards, filtros, menu) no MySQL deste ambiente.',
    description: 'Tooltip do botão Sincronizar DE-PARA UI',
  },
  {
    id: '00000000-0000-4003-8000-000000000182',
    text_key: 'action.platform.ui_catalog_apply.done',
    module_code: 'CORE',
    kind: 'field_label',
    default_text:
      'Catálogo UI sincronizado ({texts} textos, {menu} itens de menu). Recarregue a tela se os rótulos não mudarem.',
  },
  {
    id: '00000000-0000-4003-8000-000000000183',
    text_key: 'menu.invest.options.exposure',
    module_code: 'INVEST',
    kind: 'menu_item',
    default_text: 'Exposição',
  },
  {
    id: '00000000-0000-4003-8000-000000000184',
    text_key: 'screen.invest.options.exposure.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Opções — Exposição',
  },
  {
    id: '00000000-0000-4003-8000-000000000185',
    text_key: 'screen.invest.options.exposure.empty',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Nenhuma posição neste vencimento.',
  },
  {
    id: '00000000-0000-4003-8000-000000000186',
    text_key: 'field.invest.options.exposure.pct_near',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Faixa próxima (%)',
  },
  {
    id: '00000000-0000-4003-8000-000000000187',
    text_key: 'field.invest.options.exposure.pct_far',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'Faixa intermediária até (%)',
  },
  {
    id: '00000000-0000-4003-8000-000000000188',
    text_key: 'screen.invest.options.exposure.put_title',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'PUTs — dinheiro possível no exercício',
  },
  {
    id: '00000000-0000-4003-8000-000000000189',
    text_key: 'screen.invest.options.exposure.put_help',
    module_code: 'INVEST',
    kind: 'description',
    default_text:
      'Notional por ação no vencimento: ITM/ATM, até a faixa próxima e faixa intermediária (até {pct}% acima do strike).',
  },
  {
    id: '00000000-0000-4003-8000-000000000190',
    text_key: 'screen.invest.options.exposure.call_title',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text: 'CALLs — notional por proximidade do strike',
  },
  {
    id: '00000000-0000-4003-8000-000000000191',
    text_key: 'screen.invest.options.exposure.call_help',
    module_code: 'INVEST',
    kind: 'description',
    default_text:
      'Mesma estrutura das PUTs, espelhada abaixo do strike: ITM/ATM e faixas até {pct}% de distância.',
  },
  {
    id: '00000000-0000-4003-8000-000000000192',
    text_key: 'column.invest.options.exposure.asset',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Ativo',
  },
  {
    id: '00000000-0000-4003-8000-000000000193',
    text_key: 'column.invest.options.exposure.itm',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Já ITM / ATM',
  },
  {
    id: '00000000-0000-4003-8000-000000000194',
    text_key: 'column.invest.options.exposure.band_near_put',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Até ~{pct}% acima',
  },
  {
    id: '00000000-0000-4003-8000-000000000195',
    text_key: 'column.invest.options.exposure.band_far_put',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Entre {pctNear}% e ~{pct}% acima',
  },
  {
    id: '00000000-0000-4003-8000-000000000196',
    text_key: 'column.invest.options.exposure.band_near_call',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Até ~{pct}% abaixo',
  },
  {
    id: '00000000-0000-4003-8000-000000000197',
    text_key: 'column.invest.options.exposure.band_far_call',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Entre {pctNear}% e ~{pct}% abaixo',
  },
  {
    id: '00000000-0000-4003-8000-000000000198',
    text_key: 'column.invest.options.exposure.total',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Notional total',
  },
  {
    id: '00000000-0000-4003-8000-000000000199',
    text_key: 'column.invest.options.exposure.total_row',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'TOTAL',
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
  {
    id: '00000000-0000-4003-8000-000000000110',
    text_key: 'screen.invest.conciliacao.title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Conciliação',
  },

  {
    id: '00000000-0000-4003-8000-000000000110',
    text_key: 'label.common.period_from',
    module_code: 'CORE',
    kind: 'field_label',
    default_text: 'De',
  },
  {
    id: '00000000-0000-4003-8000-000000000111',
    text_key: 'label.common.period_to',
    module_code: 'CORE',
    kind: 'field_label',
    default_text: 'Até',
  },
  {
    id: '00000000-0000-4003-8000-000000000112',
    text_key: 'action.common.update',
    module_code: 'CORE',
    kind: 'button_label',
    default_text: 'Atualizar',
  },
  {
    id: '00000000-0000-4003-8000-000000000113',
    text_key: 'action.common.load_template',
    module_code: 'INVEST',
    kind: 'button_label',
    default_text: 'Carregar modelo',
  },
  {
    id: '00000000-0000-4003-8000-000000000114',
    text_key: 'action.common.import_recalc',
    module_code: 'INVEST',
    kind: 'button_label',
    default_text: 'Importar e recalcular',
  },
  {
    id: '00000000-0000-4003-8000-000000000115',
    text_key: 'screen.invest.resultado.import_title',
    module_code: 'INVEST',
    kind: 'screen_title',
    default_text: 'Importar carteira e notas',
  },
  {
    id: '00000000-0000-4003-8000-000000000116',
    text_key: 'screen.invest.resultado.import_help',
    module_code: 'INVEST',
    kind: 'field_label',
    default_text:
      'Cole JSON com opening_date, opening_positions, entries e opcionalmente monthly_statements. O sistema recalcula custódia e o pivot.',
  },
  {
    id: '00000000-0000-4003-8000-000000000117',
    text_key: 'column.invest.stock_gain.underlying',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Ação',
  },
  {
    id: '00000000-0000-4003-8000-000000000118',
    text_key: 'column.invest.stock_gain.preco_estrito',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Preço estrito (PM)',
  },
  {
    id: '00000000-0000-4003-8000-000000000119',
    text_key: 'column.invest.stock_gain.cotacao_atual',
    module_code: 'INVEST',
    kind: 'column_label',
    default_text: 'Cotação atual',
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
    metadata: typeMeta('notes-type--call', '#86efac', '--invest-type-call'),
  },
  {
    id: '00000000-0000-4003-8000-000000000302',
    text_key: 'value.invest.trade_type.put',
    module_code: 'INVEST',
    kind: 'value_label',
    default_text: 'PUT',
    metadata: typeMeta('notes-type--put', '#d8b4fe', '--invest-type-put'),
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

export const MENU: MenuSeed[] = [
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
    path: '/invest/portfolio',
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
    path: '/invest/opcoes',
    icon: null,
    order_index: 30,
    text_key: 'menu.invest.options',
    access_resource_key: 'screen.invest.portfolio',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000027',
    code: 'invest.options.table',
    parent_code: 'invest.options',
    module_code: 'INVEST',
    path: '/invest/opcoes/tabela',
    icon: null,
    order_index: 31,
    text_key: 'menu.invest.options.table',
    access_resource_key: 'screen.invest.portfolio',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000028',
    code: 'invest.options.cards',
    parent_code: 'invest.options',
    module_code: 'INVEST',
    path: '/invest/opcoes/cards',
    icon: null,
    order_index: 32,
    text_key: 'menu.invest.options.cards',
    access_resource_key: 'screen.invest.portfolio',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000029',
    code: 'invest.options.expiry',
    parent_code: 'invest.options',
    module_code: 'INVEST',
    path: '/invest/opcoes/vencimentos',
    icon: null,
    order_index: 33,
    text_key: 'menu.invest.options.expiry',
    access_resource_key: 'screen.invest.portfolio',
    visibility: 'all',
  },
  {
    id: '00000000-0000-4004-8000-000000000030',
    code: 'invest.options.exposure',
    parent_code: 'invest.options',
    module_code: 'INVEST',
    path: '/invest/opcoes/exposicao',
    icon: null,
    order_index: 34,
    text_key: 'menu.invest.options.exposure',
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
    id: '00000000-0000-4004-8000-000000000070',
    code: 'invest.conciliacao',
    parent_code: 'invest',
    module_code: 'INVEST',
    path: '/invest/conciliacao',
    icon: null,
    order_index: 65,
    text_key: 'menu.invest.conciliacao',
    access_resource_key: 'screen.invest.conciliacao',
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
    else {
      const existingId = await findIdByColumn(
        gateway,
        ctx,
        'ui_text_catalog',
        'text_key',
        t.text_key
      );
      if (existingId) {
        await gateway.update(ctx, 'ui_text_catalog', existingId, {
          default_text: t.default_text,
          description: t.description ?? null,
          ...(t.metadata ? { metadata: t.metadata } : {}),
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

export { LOCALE };

const isDirectRun = (process.argv[1] || '').replace(/\\/g, '/').includes('008_ui_catalog');

if (isDirectRun) {
  run().catch((err) => {
    console.error('Falha no seed UI catalog:', err);
    process.exit(1);
  });
}
