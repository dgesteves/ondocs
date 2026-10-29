// Workers AI's embedding models over Cloudflare's REST API, so an index can be built with the
// model the Cloudflare Worker template embeds questions with through its AI binding. It sends
// what the binding sends, `{ text: [...] }`, so both sides get the model's default pooling.
import type { EmbeddingModel } from 'ai';

// The embedding model specification both AI SDK 6 and 7 take: AI SDK 7 reads a v3 embedding model
// as its own v4, with nothing to convert, and AI SDK 6 has no v4.
type EmbeddingModelV3 = Extract<EmbeddingModel, { specificationVersion: 'v3' }>;

export interface WorkersAiEmbeddingOptions {
  /** Your Cloudflare account's id. */
  accountId: string;
  /** An API token allowed to run Workers AI (Workers AI Read and Edit). */
  apiToken: string;
  /** Default `https://api.cloudflare.com/client/v4`; a stub's URL in tests. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Texts per request: Workers AI's limit, 100, or 32 for the Qwen3 embedding models. */
const textsPerRequest = (modelId: string): number =>
  modelId.includes('qwen3-embedding') ? 32 : 100;

interface RunResponse {
  success?: boolean;
  result?: { data?: unknown; shape?: unknown };
  errors?: { message?: string; code?: number }[];
}

/**
 * A Workers AI embedding model, such as `@cf/baai/bge-small-en-v1.5`, called through Cloudflare's
 * REST API with your account id and API token. For building an index; the Worker embeds
 * questions with the same model through its `AI` binding.
 */
export function workersAiEmbedding(
  modelId: string,
  options: WorkersAiEmbeddingOptions,
): EmbeddingModelV3 {
  const base = (options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
  const url = `${base}/accounts/${encodeURIComponent(options.accountId)}/ai/run/${modelId}`;
  const fetcher = options.fetch ?? fetch;
  return {
    specificationVersion: 'v3',
    provider: 'workers-ai',
    modelId,
    maxEmbeddingsPerCall: textsPerRequest(modelId),
    supportsParallelCalls: true,
    async doEmbed({ values, abortSignal }) {
      const response = await fetcher(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: values }),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      let body: RunResponse;
      try {
        body = (await response.json()) as RunResponse;
      } catch {
        throw new Error(`Workers AI ${modelId}: HTTP ${String(response.status)}, not JSON.`);
      }
      if (!response.ok || body.success === false) {
        const reason = body.errors?.map((error) => error.message).join('; ');
        throw new Error(
          `Workers AI ${modelId}: HTTP ${String(response.status)}${reason ? `, ${reason}` : ''}.`,
        );
      }
      const data = body.result?.data;
      if (
        !Array.isArray(data) ||
        data.length !== values.length ||
        !data.every((row) => Array.isArray(row) && row.every((x) => typeof x === 'number'))
      ) {
        throw new Error(
          `Workers AI ${modelId} returned no embeddings for the ${String(values.length)} texts it was sent.`,
        );
      }
      return { embeddings: data, warnings: [] };
    },
  };
}
