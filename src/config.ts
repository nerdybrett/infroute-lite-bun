/**
 * infroute-lite-bun — environment configuration.
 * Reads .env via Bun.env (no dotenv dependency). All config is env-driven
 * so the image stays small and 12-factor friendly.
 */

import type { ProviderConfig, GatewayStats } from "./types.js";

const PORT = Number.parseInt(Bun.env.PORT ?? "3000", 10);
const HOST = Bun.env.HOST ?? "0.0.0.0";
const API_KEY = Bun.env.API_KEY ?? "";
const REQUEST_TIMEOUT_MS = Number.parseInt(
  Bun.env.REQUEST_TIMEOUT_MS ?? "30000",
  10,
);
const MAX_BODY_MB = Number.parseInt(Bun.env.MAX_BODY_MB ?? "8", 10);
const DEFAULT_MODEL = Bun.env.DEFAULT_MODEL ?? undefined;
const CORS_ORIGIN = Bun.env.CORS_ORIGIN ?? "*";

let PROVIDERS_RAW: ProviderConfig[] = [];
try {
  const raw = Bun.env.PROVIDERS ?? "[]";
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    PROVIDERS_RAW = parsed.map((p, i) => ({
      name: String(p.name ?? `provider-${i}`),
      apiKeyEnv: String(p.apiKeyEnv ?? ""),
      baseUrl: String(p.baseUrl ?? "").replace(/\/$/, ""),
      models: Array.isArray(p.models) ? p.models.map(String) : ["*"],
      priority: Number.isFinite(Number(p.priority))
        ? Number(p.priority)
        : i,
      fallbackCodes: Array.isArray(p.fallbackCodes)
        ? (p.fallbackCodes as number[])
        : [429, 502, 503, 504],
      timeoutMs:
        p.timeoutMs == null || Number.isNaN(Number(p.timeoutMs))
          ? undefined
          : Number(p.timeoutMs),
    }));
  }
} catch {
  PROVIDERS_RAW = [];
}

/** Resolve apiKeyEnv -> actual secret at startup. Providers without a key are skipped. */
export function resolveProviders(): ProviderConfig[] {
  const resolved: ProviderConfig[] = [];
  for (const p of PROVIDERS_RAW) {
    if (!p.apiKeyEnv) continue;
    const key = Bun.env[p.apiKeyEnv];
    if (!key) {
      console.warn(
        `[infroute-lite] skipping provider "${p.name}": env ${p.apiKeyEnv} not set`,
      );
      continue;
    }
    resolved.push({ ...p, apiKey: key });
  }
  resolved.sort((a, b) => a.priority - b.priority);
  return resolved;
}

export const config = {
  port: PORT,
  host: HOST,
  apiKey: API_KEY,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  maxBodyBytes: MAX_BODY_MB * 1024 * 1024,
  defaultModel: DEFAULT_MODEL,
  corsOrigin: CORS_ORIGIN,
  providers: resolveProviders(),
} as const;

export const stats: GatewayStats = {
  requestsTotal: 0,
  requestsByProvider: {},
  fallbacksTotal: 0,
};

export function isAuthDisabled() {
  return config.apiKey.length === 0;
}

export function requireApiKey(authorization: string | null, xKey: string | null) {
  if (isAuthDisabled()) return true;
  const expected = `Bearer ${config.apiKey}`;
  return authorization === expected || xKey === config.apiKey;
}
