import { GatewayError } from '../../dal/errors';
import type {
  BrokerParseMetadata,
  BrokerParseResult,
  IBrokerExtractParser,
} from './IBrokerExtractParser';

export class BrokerParserRegistry {
  private readonly parsers: IBrokerExtractParser[] = [];

  register(parser: IBrokerExtractParser): void {
    const key = `${parser.brokerCode}:${parser.parserVersion}`;
    if (this.parsers.some((p) => `${p.brokerCode}:${p.parserVersion}` === key)) return;
    this.parsers.push(parser);
  }

  parse(rawContent: string, meta?: BrokerParseMetadata): BrokerParseResult {
    for (const parser of this.parsers) {
      if (parser.canParse(rawContent, meta)) {
        return parser.parse(rawContent, meta);
      }
    }
    throw new GatewayError(
      'INVALID_PAYLOAD',
      `Nenhum parser reconheceu o arquivo${meta?.filename ? ` ${meta.filename}` : ''}.`,
      400
    );
  }

  listParsers(): Array<{ brokerCode: string; parserVersion: string }> {
    return this.parsers.map((parser) => ({
      brokerCode: parser.brokerCode,
      parserVersion: parser.parserVersion,
    }));
  }
}

export const brokerParserRegistry = new BrokerParserRegistry();
