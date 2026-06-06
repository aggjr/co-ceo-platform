export type {
  BrokerParseMetadata,
  BrokerParseResult,
  IBrokerExtractParser,
  ParsedBrokerEvent,
} from './IBrokerExtractParser';
import { brokerParserRegistry } from './BrokerParserRegistry';
import { BtgBrokerageNoteParserAdapter } from './BtgBrokerageNoteParserAdapter';
import { BtgExtractParserAdapter } from './BtgExtractParserAdapter';

export { BrokerParserRegistry, brokerParserRegistry } from './BrokerParserRegistry';
export { BtgBrokerageNoteParserAdapter } from './BtgBrokerageNoteParserAdapter';
export { BtgExtractParserAdapter } from './BtgExtractParserAdapter';

export function registerDefaultBrokerParsers(): void {
  brokerParserRegistry.register(new BtgBrokerageNoteParserAdapter());
  brokerParserRegistry.register(new BtgExtractParserAdapter());
}
