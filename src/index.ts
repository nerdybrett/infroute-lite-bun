#!/usr/bin/env bun
/**
 * infroute-lite-bun — entry point.
 * Low-resource Bun AI gateway. Uses Bun.serve (no web framework) and Bun's
 * built-in fetch. Designed to run on wispbyte free-tier servers.
 *
 * Start:
 *   cp .env.example .env   # edit .env with your keys
 *   bun run src/index.ts
 */

import { config, stats, isAuthDisabled } from "./config.js";
import {
  corsHeaders,
  jsonError,
  checkAuth,
  parseJsonBody,
  validateChatRequest,
  logRequest,
  handleOptions,
} from "./middleware.js";
import {
  routeChatCompletion,
  routeChatCompletionStream,
} from "./router.js";
import type { ChatCompletionRequest } from "./types.js";

const VERSION = "1.0.0";
const START_AT = new Date().toISOString();

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);
  const start = Date.now();

  // CORS preflight
  if (req.method === "OPTIONS") {
    return handleOptions(origin);
  }

  // Auth (applies to all routes)
  const authFail = checkAuth(
    req.headers.get("authorization"),
    req.headers.get("x-infroute-key"),
  );
  if (authFail) {
    logRequest(req, 401, undefined, Date.now() - start);
    return new Response(authFail.body, {
      status: 401,
      headers: { "Content-Type": "application/json", ...ch },
    });
  }

  // ---------- Health ----------
  if (pathname === "/health" && req.method === "GET") {
    const body = JSON.stringify({
      status: "ok",
      version: VERSION,
      runtime: "bun",
      auth: isAuthDisabled() ? "disabled" : "enabled",
      providers: config.providers.map((p) => ({
        name: p.name,
        models: p.models,
        priority: p.priority,
      })),
      uptime_ms: Date.now() - new Date(START_AT).getTime(),
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", ...ch },
    });
  }

  // ---------- List models ----------
  if (pathname === "/v1/models" && req.method === "GET") {
    const seen = new Set<string>();
    const data: Array<{ id: string; object: "model"; owned_by: string }> = [];
    for (const p of config.providers) {
      for (const m of p.models) {
        if (m === "*") continue;
        if (seen.has(m)) continue;
        seen.add(m);
        data.push({ id: m, object: "model", owned_by: p.name });
      }
    }
    const body = JSON.stringify({ object: "list", data });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", ...ch },
    });
  }

  // ---------- Chat completions ----------
  if (pathname === "/v1/chat/completions" && req.method === "POST") {
    const parsed = await parseJsonBody<ChatCompletionRequest>(req);
    if ("error" in parsed) {
      logRequest(req, 400, undefined, Date.now() - start);
      return parsed.error;
    }

    // Apply default model if client omitted it
    if (!parsed.model && config.defaultModel) {
      parsed.model = config.defaultModel;
    }

    const validated = validateChatRequest(parsed);
    if ("error" in validated) {
      logRequest(req, 400, undefined, Date.now() - start);
      return validated.error;
    }
    const request: ChatCompletionRequest = validated;
    const stream = request.stream === true;

    try {
      if (stream) {
        const { decision, response } = await routeChatCompletionStream(request);
        const merged = new Headers(response.headers);
        for (const [k, v] of Object.entries(ch)) merged.set(k, v);
        merged.set("X-Infroute-Provider", decision.provider.name);
        logRequest(req, 200, decision.provider.name, Date.now() - start);
        return new Response(response.body, {
          status: response.status,
          headers: merged,
        });
      }

      const { decision, response } = await routeChatCompletion(request);
      const body = JSON.stringify(response);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...ch,
          "X-Infroute-Provider": decision.provider.name,
        },
      });
    } catch (err) {
      const e = err as Error & { status?: number; provider?: string };
      const status = e.status ?? 502;
      let code = "upstream_error";
      let message = "All providers failed";
      if (status === 404) {
        code = "model_not_found";
        message = e.message ?? `No provider configured for model "${request.model}"`;
      } else if (e.message) {
        message = e.message;
      }
      logRequest(req, status, e.provider, Date.now() - start);
      return jsonError(status, code, message, ch);
    }
  }

  // ---------- 404 ----------
  return jsonError(404, "not_found", `Cannot ${req.method} ${pathname}`, ch);
}

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: handleRequest,
  idleTimeout: 20,
});

console.log(
  `[infroute-lite] listening on http://${config.host}:${config.port} (auth: ${isAuthDisabled() ? "disabled" : "enabled"}, providers: ${config.providers.length})`,
);
console.log(
  `[infroute-lite] providers: ${config.providers.map((p) => `${p.name} (priority ${p.priority})`).join(", ") || "none"}`,
);

export default server;
