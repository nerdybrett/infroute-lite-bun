/**
 * infroute-lite-bun — request router.
 * Selects providers that support the requested model, ordered by priority,
 * and tries them in sequence with automatic fallback on retryable errors.
 */

import type {
  ResolvedProvider,
  RouteDecision,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "./types.js";
import { config, stats } from "./config.js";
import {
  chatCompletion,
  chatCompletionStream,
  providerUrl,
  isRetryable,
} from "./providers.js";

/** Pick providers supporting `model`, sorted by priority. A "*" model matches anything. */
export function selectProviders(model: string): ResolvedProvider[] {
  return config.providers.filter((p) =>
    p.models.includes("*") || p.models.includes(model),
  );
}

/**
 * Route a chat/completions request to the first healthy provider.
 * Returns { decision, response } for non-streaming.
 * Throws the last ProviderError if every provider fails.
 */
export async function routeChatCompletion(
  request: ChatCompletionRequest,
): Promise<{ decision: RouteDecision; response: ChatCompletionResponse }> {
  const candidates = selectProviders(request.model);
  if (candidates.length === 0) {
    const err = Object.assign(
      new Error(`No provider configured for model "${request.model}"`),
      { status: 404, provider: undefined, retryable: false },
    ) as Error & { status?: number; provider?: string; retryable: boolean };
    throw err;
  }

  let lastError: unknown;
  let fallbacks = 0;

  for (const provider of candidates) {
    try {
      const response = await chatCompletion(provider, request);
      stats.requestsTotal += 1;
      stats.requestsByProvider[provider.name] =
        (stats.requestsByProvider[provider.name] ?? 0) + 1;
      stats.fallbacksTotal += fallbacks;
      return {
        decision: {
          provider,
          upstreamUrl: providerUrl(provider),
        },
        response,
      };
    } catch (err) {
      lastError = err;
      const pe = err as Error & { status?: number; retryable?: boolean };
      if (isRetryable(pe as never)) {
        fallbacks += 1;
        console.warn(
          `[infroute-lite] provider "${provider.name}" failed (${pe.status ? pe.status : "network/timeout"}), falling back`,
        );
        continue;
      }
      // Non-retryable error from the first able provider: surface it.
      throw err;
    }
  }

  throw lastError;
}

/**
 * Route a streaming chat/completions request.
 * Tries providers in order; on a retryable failure before stream headers are
 * committed, moves to the next. Returns a Response ready to send to the client.
 */
export async function routeChatCompletionStream(
  request: ChatCompletionRequest,
): Promise<{
  decision: RouteDecision;
  response: Response;
  stream: ReadableStream<Uint8Array>;
}> {
  const candidates = selectProviders(request.model);
  if (candidates.length === 0) {
    const err = Object.assign(
      new Error(`No provider configured for model "${request.model}"`),
      { status: 404, provider: undefined, retryable: false },
    ) as Error & { status?: number; provider?: string; retryable: boolean };
    throw err;
  }

  let lastError: unknown;
  let fallbacks = 0;

  for (const provider of candidates) {
    try {
      const stream = await chatCompletionStream(provider, request);

      // Ensure we have a real stream (not a thrown error wrapped in a value)
      const readable = stream as ReadableStream<Uint8Array>;

      stats.requestsTotal += 1;
      stats.requestsByProvider[provider.name] =
        (stats.requestsByProvider[provider.name] ?? 0) + 1;
      stats.fallbacksTotal += fallbacks;

      return {
        decision: {
          provider,
          upstreamUrl: providerUrl(provider),
        },
        response: new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Infroute-Provider": provider.name,
          },
        }),
        stream: readable,
      };
    } catch (err) {
      lastError = err;
      const pe = err as Error & { status?: number; retryable?: boolean };
      if (isRetryable(pe as never)) {
        fallbacks += 1;
        console.warn(
          `[infroute-lite] stream provider "${provider.name}" failed (${pe.status ? pe.status : "network/timeout"}), falling back`,
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export type { RouteDecision, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk };
