# infroute-lite-bun — tiny container for wispbyte or any Bun-capable host
FROM oven/bun:1.1-slim AS runner

WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0

# Copy only source + config (no node_modules needed — zero runtime deps)
COPY package.json bunfig.toml tsconfig.json ./
COPY src ./src

# .env is NOT copied — mount it at runtime or use docker run --env-file
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
