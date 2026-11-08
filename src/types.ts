/**
 * infroute-lite-bun — core types.
 * OpenAI-compatible chat completions subset, kept intentionally small for low memory.
 */

export type ProviderName = string;

export interface ProviderModel {
  /** Exact model id, or "*" to accept any model id from the client. */
  id: string;
}

export interface ProviderConfig {
  name: ProviderName;
  /** Env var name holding the upstream API key (resolved at runtime). */
  apiKeyEnv: string;
  baseUrl: string;
  /** Model ids this provider can serve. "*" = all models. */
  models: string[];
  /** Lower number = tried first in failover. */
  priority: number;
  /** HTTP status codes that trigger automatic fallback to the next provider. */
  fallbackCodes: number[];
  /** Per-provider request timeout override (ms). Undefined = use global default. */
  timeoutMs?: number;
}

export interface ResolvedProvider extends ProviderConfig {
  apiKey: string; // resolved from apiKeyEnv
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  max_tokens?: number;
  stop?: string | string[];
  n?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  // Passthrough for provider-specific fields (OpenAI-compatible upstreams ignore unknowns)
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  system_fingerprint?: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    delta: ChatMessage;
    finish_reason: ChatCompletionChoice["finish_reason"] | null;
  }>;
}

export interface RouteDecision {
  provider: ResolvedProvider;
  upstreamUrl: string; // e.g. https://api.openai.com/v1/chat/completions
}

export interface ProviderError extends Error {
  status?: number;
  provider?: ProviderName;
  retryable: boolean;
}

export interface GatewayStats {
  requestsTotal: number;
  requestsByProvider: Record<ProviderName, number>;
  fallbacksTotal: number;
  lastRequestAt?: string;
}
