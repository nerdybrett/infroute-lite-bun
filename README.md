# infroute-lite-bun

Low-resource **Bun** runtime AI gateway inspired by [infroute / OmniRoute](https://github.com/nerdybrett/infroute) — one endpoint, multiple providers, quota-aware auto-fallback.

Designed specifically to run on **wispbyte free-use servers** (Bun or Node). Unlike full infroute (Next.js + SQLite + 224 migrations + Electron), this is a single-file-ish Bun server with **zero runtime dependencies**, using `Bun.serve` + built-in `fetch`. Expected RSS ~15–40 MB idle.

## Features

| | |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible (works with Cursor, Cline, Codex, Copilot, OpenCode) |
| Streaming (SSE) | Proxied upstream `text/event-stream` |
| `GET /v1/models` | List configured models |
| `GET /health` | Health / provider status |
| Auto-fallback | Tries providers by priority; on 429/502/503/504/timeout moves to the next |
| API-key auth | `Authorization: Bearer <key>` or `X-Infroute-Key` |
| CORS | Configurable `CORS_ORIGIN` |
| No DB, no build step, no frontend | Runs via `bun run src/index.ts` |

## Quick start

```bash
git clone <this-repo> infroute-lite-bun
cd infroute-lite-bun
cp .env.example .env
# edit .env — set API_KEY and at least one provider + its key
bun install        # optional (no runtime deps; installs nothing)
bun run src/index.ts
```

### Example `.env`

```
PORT=3000
API_KEY=sk-infroute-change-me

REQUEST_TIMEOUT_MS=30000
MAX_BODY_MB=8

PROVIDERS='[
  {"name":"openrouter","apiKeyEnv":"OPENROUTER_API_KEY","baseUrl":"https://openrouter.ai/api/v1","models":["*"],"priority":1},
  {"name":"groq","apiKeyEnv":"GROQ_API_KEY","baseUrl":"https://api.groq.com/openai/v1","models":["*"],"priority":2},
  {"name":"openai","apiKeyEnv":"OPENAI_API_KEY","baseUrl":"https://api.openai.com/v1","models":["gpt-4o-mini","gpt-4o"],"priority":3}
]'

OPENROUTER_API_KEY=sk-or-...
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-...

CORS_ORIGIN=*
```

> **Tip for "375 providers":** put **OpenRouter** as priority 1 with `models: ["*"]`. OpenRouter is itself OpenAI-compatible and routes to 375+ providers, so this lite gateway inherits infroute's provider coverage without the weight.

## Test it

```bash
# Health
curl http://localhost:3000/health

# Models
curl http://localhost:3000/v1/models

# Chat (non-streaming)
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-infroute-change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}' | head -c 400

# Chat (streaming)
curl -s -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-infroute-change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"count to 5"}]}'
```

## Deploy on wispbyte (free tier)

wispbyte free servers typically run **Bun or Node** and give you a public port. Steps:

1. Upload this folder to the server (or `git clone` it there).
2. Install Bun (if not present):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   source $HOME/.bashrc   # or .zshrc
   bun --version
   ```
3. Create `.env` from `.env.example` and fill in your keys (never commit `.env`).
4. Start:
   ```bash
   bun run src/index.ts
   ```
5. For persistence, run under a process manager (systemd, pm2, or bun's `--pid`/nohup) and bind to `0.0.0.0:${PORT}` so wispbyte can route the public port to you.

### systemd service (if available)

```ini
# /etc/systemd/system/infroute-lite.service
[Unit]
Description=infroute-lite-bun AI gateway
After=network.target

[Service]
Type=simple
User=wispbyte
WorkingDirectory=/home/wispbyte/infroute-lite-bun
EnvironmentFile=/home/wispbyte/infroute-lite-bun/.env
ExecStart=/home/wispbyte/.bun/bin/bun run /home/wispbyte/infroute-lite-bun/src/index.txt
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Bun not available? Node fallback

If your wispbyte server only has Node, install Bun anyway (single binary, ~30 MB) — it's the intended runtime. If you truly cannot, the code uses standard Web APIs (`fetch`, `ReadableStream`, `Request`/`Response`) so it can be ported to Node ≥18 with minimal changes (swap `Bun.serve` for `http.createServer` / `@hono/node-server` and `Bun.env` for `process.env`).

## Project layout

```
infroute-lite-bun/
├── package.json        # no runtime deps
├── bunfig.toml
├── tsconfig.json
├── .env.example        # copy to .env
├── Dockerfile          # optional container
├── README.md
└── src/
    ├── index.ts        # Bun.serve entry + routing
    ├── config.ts       # env parsing, provider resolution, auth
    ├── types.ts        # OpenAI-compatible types
    ├── providers.ts    # fetch transport + retry classification
    ├── router.ts       # provider selection + failover
    └── middleware.ts   # auth, CORS, body limit, logging, errors
```

## License

MIT — based on concepts from infroute/OmniRoute (MIT).
