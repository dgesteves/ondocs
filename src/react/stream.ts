import { SOURCE_METADATA_KEY, type AskMetadata, type AskSource } from '../protocol';

export interface AskStreamHandlers {
  /** The answer's metadata, with its id (the stream's `messageId`) when the server sent one. */
  metadata?: (metadata: AskMetadata & { id?: string }) => void;
  source?: (source: AskSource) => void;
  delta?: (text: string) => void;
  error?: (message: string) => void;
  /**
   * The server finished the message, with the model's finish reason when it sent one (`"length"`
   * means the answer hit the output limit). A stream that ends without it was cut off.
   */
  finish?: (finishReason?: string) => void;
}

type Part = Record<string, unknown> & { type?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function toMetadata(value: unknown, id: unknown): (AskMetadata & { id?: string }) | null {
  if (!isRecord(value) || typeof value.refused !== 'boolean') return null;
  return {
    refused: value.refused,
    retrieval: value.retrieval === 'keyword' ? 'keyword' : 'hybrid',
    ...(value.feedback === true ? { feedback: true } : {}),
    ...(typeof id === 'string' && id ? { id } : {}),
  };
}

function toSource(part: Part): AskSource | null {
  const id = Number(part.sourceId);
  if (!Number.isInteger(id) || typeof part.url !== 'string') return null;
  const meta = isRecord(part.providerMetadata) ? part.providerMetadata[SOURCE_METADATA_KEY] : null;
  const title = isRecord(meta) && typeof meta.title === 'string' ? meta.title : part.title;
  const heading = isRecord(meta) && typeof meta.heading === 'string' ? meta.heading : '';
  return { id, url: part.url, title: typeof title === 'string' ? title : part.url, heading };
}

function dispatch(part: Part, on: AskStreamHandlers): void {
  switch (part.type) {
    case 'start':
    case 'message-metadata': {
      const metadata = toMetadata(part.messageMetadata, part.messageId);
      if (metadata) on.metadata?.(metadata);
      break;
    }
    case 'source-url': {
      const source = toSource(part);
      if (source) on.source?.(source);
      break;
    }
    case 'text-delta':
      if (typeof part.delta === 'string') on.delta?.(part.delta);
      break;
    case 'error':
      on.error?.(typeof part.errorText === 'string' ? part.errorText : 'The stream failed.');
      break;
    case 'finish': {
      // The server can amend the metadata as the answer ends: a reply of only "I don't know".
      const metadata = toMetadata(part.messageMetadata, part.messageId);
      if (metadata) on.metadata?.(metadata);
      on.finish?.(typeof part.finishReason === 'string' ? part.finishReason : undefined);
      break;
    }
    default:
      // Unknown parts (step markers, future additions) are ignored, not errors.
      break;
  }
}

/**
 * Reads an ask response body (an AI SDK UI message stream: Server-Sent Events whose `data:`
 * lines are JSON parts) and calls the matching handler for each part, in order.
 *
 * A dozen lines of SSE parsing keep the client free of the `ai` package and its schemas.
 */
export async function readAskStream(
  body: ReadableStream<Uint8Array>,
  on: AskStreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = done ? '' : (events.pop() ?? '');
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
        .join('\n');
      if (!data || data === '[DONE]') continue;
      let part: unknown;
      try {
        part = JSON.parse(data);
      } catch {
        continue;
      }
      if (isRecord(part)) dispatch(part, on);
    }
    if (done) return;
  }
}
