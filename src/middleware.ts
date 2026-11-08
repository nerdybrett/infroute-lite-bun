/**
 * infroute-lite-bun — HTTP middleware helpers.
 * Auth, CORS, JSON body parsing with size limit, structured logging, and
 * standard error responses. Zero dependencies.
 */

import type { ChatCompletionRequest } from "./types.js";
import { config, isAuthDisabled, requireApiKey } from "./config.js";

export interface MatchedRoute {
  path: string;
  method: string;
}

export function corsHeaders(origin: string | null) {
  const allow = config.corsOrigin === "*" ? "*" : config.corsOrigin;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Infroute-Key, Accept",
    "Access-Control-Max-Age": "86400",
    "X-Infroute-Version": "1.0.0",
  };
  if (config.corsOrigin === "*") {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
) {
  const body = JSON.stringify({
    error: { code, message, type: "infroute_error", status },
  });
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function checkAuth(
  authorization: string | null,
  xInfrouteKey: string | null,
): Response | null {
  if (isAuthDisabled()) return null;
  if (!requireApiKey(authorization, xInfrouteKey)) {
    return jsonError(401, "invalid_api_key", "Missing or invalid API key");
  }
  return null;
}

export async function parseJsonBody<T>(
  req: Request,
): Promise<T | { error: Response }> {
  const contentLength = req.headers.get("content-length");
  if (contentLength != null) {
    const len = Number.parseInt(contentLength, 10);
    if (len > config.maxBodyBytes) {
      return {
        error: jsonError(
          413,
          "request_entity_too_large",
          `Request body exceeds ${config.maxBodyBytes / 1024 / 1024} MB`,
        ),
      };
    }
  }

  try {
    const body = (await req.json()) as T;
    return body;
  } catch {
    return {
      error: jsonError(400, "invalid_json", "Request body is not valid JSON"),
    };
  }
}

export function validateChatRequest(body: unknown): ChatCompletionRequest | { error: Response } {
  if (!body || typeof body !== "object") {
    return { error: jsonError(400, "invalid_request", "Request body must be a JSON object") };
  }
  const r = body as Record<string, unknown>;
  if (typeof r.model !== "string" || r.model.length === 0) {
    return { error: jsonError(400, "invalid_request", "Field 'model' is required") };
  }
  if (!Array.isArray(r.messages) || r.messages.length === 0) {
    return { error: jsonError(400, "invalid_request", "Field 'messages' must be a non-empty array") };
  }
  return r as ChatCompletionRequest;
}

export function logRequest(req: Request, status: number, provider?: string, ms?: number) {
  const u = new URL(req.url);
  const providerTag = provider ? ` provider=${provider}` : "";
  const msTag = ms != null ? ` ${ms}ms` : "";
  console.log(
    `[infroute-lite] ${req.method} ${u.pathname} -> ${status}${providerTag}${msTag}`,
  );
}

export function handleOptions(origin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
