export type ParsedBrokerEvent = {
  sourceRef: string;
  eventKind: string;
  occurredOn: string;
  settlesOn: string;
  ticker: string;
  assetType: string;
  underlyingTicker?: string | null;
  quantity: number;
  unitPrice: number;
  totalNetValue: number;
  currency: string;
  brokerageRef?: string | null;
  notes?: string | null;
  rawLine?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type BrokerParseResult = {
  events: ParsedBrokerEvent[];
  warnings: string[];
  source: string;
};

export type BrokerParseMetadata = {
  filename?: string;
  format?: string;
};

export interface IBrokerExtractParser {
  readonly brokerCode: string;
  readonly parserVersion: string;
  canParse(rawContent: string, meta?: BrokerParseMetadata): boolean;
  parse(rawContent: string, meta?: BrokerParseMetadata): BrokerParseResult;
}
