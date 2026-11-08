/**
 * infroute-lite-bun — provider transport.
 * Thin OpenAI-compatible fetch client. Most LLM providers (OpenAI, OpenRouter,
 * Groq, Together, Fireworks, etc.) expose an OpenAI-compatible /v1/chat/completions
 * endpoint, so one transport handles them all. Non-OpenAI upstreams (Anthropic,
 * Gemini) would need a request/response adapter — see TODO in chatCompletion().
 */

import type {
  ResolvedProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderError,
} from "./types.js";
import { config } from "./config.js";

const DEFAULT_FALLBACK_CODES = [429, 502, 503, 504];

/** Build the upstream chat/completions URL for a provider. */
export function providerUrl(provider: ResolvedProvider) {
  return `${provider.baseUrl}/chat/completions`;
}

/**
 * Classify whether an HTTP status + error should trigger failover.
 * Retryable: 429 (rate limit), 502/503/504 (upstream), timeouts, network errors.
 */
export function isRetryable(err: ProviderError): boolean {
  if (err.status) {
    return DEFAULT_FALLBACK_CODES.includes(err.status);
  }
  return err.retryable === true;
}

/**
 * Send a non-streaming chat completion to a single provider.
 * Throws ProviderError on failure so the router can fall back.
 */
export async function chatCompletion(
  provider: ResolvedProvider,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResponse> {
  const controller = new AbortController();
  const timeout = provider.timeoutMs ?? config.requestTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeout);

  let lastError: ProviderError;
  try {
    const url = providerUrl(provider);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const body = { ...request };
    if (body.stream === true) body.stream = false; // non-streaming mode only here

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await res.text();

    if (!res.ok) {
      lastError = Object.assign(new Error(`Upstream ${provider.name} returned ${res.status}`), {
        status: res.status,
        provider: provider.name,
        retryable: true,
      }) as ProviderError;
      throw lastError;
    }

    let parsed: ChatCompletionResponse;
    try {
      parsed = JSON.parse(responseText) as ChatCompletionResponse;
    } catch {
      lastError = Object.assign(new Error(`Upstream ${provider.name} returned invalid JSON`), {
        status: res.status,
        provider: provider.name,
        retryable: false,
      }) as ProviderError;
      throw lastError;
    }

    return {
      id: parsed.id ?? crypto.randomUUID(),
      object: "chat.completion",
      created: parsed.created ?? Math.floor(Date.now() / 1000),
      model: request.model,
      choices: parsed.choices ?? [],
      usage: parsed.usage,
    } as ChatCompletionResponse;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    lastError = Object.assign(
      new Error(
        err instanceof Error ? err.message : `Upstream ${provider.name} request failed`,
      ),
      {
        status: err instanceof Error && "status" in err ? (err as any).status : undefined,
        provider: provider.name,
        retryable: true, // network/timeout errors are retryable
      },
    ) as ProviderError;
    throw lastError;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream a chat completion from a single provider back to the client.
 * Returns a ReadableStream that proxies the upstream SSE byte-for-byte.
 * Throws ProviderError on failure so the router can fall back before headers are sent.
 */
export async function chatCompletionStream(
  provider: ResolvedProvider,
  request: ChatCompletionRequest,
): Promise<ReadableStream<Uint8Array> | Response> {
  const controller = new AbortController();
  const timeout = provider.timeoutMs ?? config.requestTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = providerUrl(provider);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    const body = { ...request, stream: true };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      const err = Object.assign(
        new Error(`Upstream ${provider.name} returned ${res.status}: ${text}`),
        {
          status: res.status,
          provider: provider.name,
          retryable: true,
        },
      ) as ProviderError;
      throw err;
    }

    return res.body.pipeThrough(new TextEncoderStream());
  } catch (err) {
    clearTimeout(timer);
    throw err;
  } finally {
    // timer cleared only on success path below by caller if needed
  }
}
