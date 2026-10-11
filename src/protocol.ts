/**
 * The wire contract between `ondocs/server` and `ondocs/react`. Types only, so the
 * client bundle never pulls in server code.
 *
 * The response is an AI SDK UI message stream (Server-Sent Events), so `useChat` from
 * `@ai-sdk/react` can consume it as well as `useAsk`:
 *
 * 1. `start`, with {@link AskMetadata} as `messageMetadata`
 * 2. one `source-url` part per numbered source; `sourceId` is the citation number
 * 3. `text-start` / `text-delta` / `text-end` for the answer, which cites sources as `[n]`
 * 4. `finish` (or `error`)
 */

/** A numbered source, as cited in the answer with `[id]`. */
export interface AskSource {
  /** Citation number, starting at 1. */
  id: number;
  /** Link to the section, anchor included. */
  url: string;
  /** Page title. */
  title: string;
  /** Section heading path; empty for the top of a page. */
  heading: string;
}

/** Sent as `messageMetadata` on the stream's `start` part. */
export interface AskMetadata {
  /** True when retrieval found nothing relevant and the answer is the "I don't know" message. */
  refused: boolean;
  /** Whether the query was embedded (`hybrid`) or matched on keywords only. */
  retrieval: 'hybrid' | 'keyword';
  /** True when the endpoint takes feedback on its answers (`onFeedback`), so a client offers it. */
  feedback?: boolean;
}

/**
 * Key under `providerMetadata` on `source-url` parts that carries the title and heading. It keeps
 * the name from before ondocs, so a dialog and an endpoint on either side of the rename still
 * show each other's citations.
 */
export const SOURCE_METADATA_KEY = 'askMySite';

/** Body of a request to the handler. `{ messages }` from `useChat` is also accepted. */
export interface AskRequestBody {
  question: string;
  /** The page's locale, for an endpoint with an index per locale. */
  locale?: string;
  /** The bot check's token, for an endpoint with `challenge` set: a fresh one per question. */
  challenge?: string;
}

/** Body of a rating of an answer, posted to the same endpoint. */
export interface AskFeedbackBody {
  feedback: {
    rating: 'up' | 'down';
    /** What the visitor wrote, if anything. At most 1,000 characters. */
    comment?: string;
    /** The answer's id, the stream's `messageId`, which `onFinish` gets too. */
    id?: string;
    question: string;
    answer: string;
    /** The URLs of the answer's sources. */
    sources?: string[];
  };
}

/** Body of every non-streaming (error) response. */
export interface AskErrorBody {
  error: {
    code:
      | 'method_not_allowed'
      | 'payload_too_large'
      | 'unsupported_media_type'
      | 'invalid_json'
      | 'invalid_request'
      | 'rate_limited'
      /** The handler's daily `budget` is spent; `Retry-After` says when it resets. */
      | 'budget_exceeded'
      /** The handler checks for bots (`challenge`), and the question came without a token. */
      | 'challenge_required'
      /** The bot check's token was bad, expired or used before. */
      | 'challenge_failed'
      | 'internal_error'
      | 'service_unavailable';
    message: string;
  };
}
