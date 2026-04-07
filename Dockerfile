# Gildara MCP Server — Docker image for Docker MCP Registry
# https://github.com/docker/mcp-registry

FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# MCP servers communicate via stdio
ENV NODE_ENV=production

# Required: user must set GILDARA_API_KEY
# Optional: GILDARA_BASE_URL (defaults to https://gildara.io)

ENTRYPOINT ["node", "dist/index.js"]

LABEL org.opencontainers.image.title="Gildara MCP Server"
LABEL org.opencontainers.image.description="Connect AI tools to your Gildara prompt vault"
LABEL org.opencontainers.image.url="https://gildara.io"
LABEL org.opencontainers.image.source="https://github.com/gildara/mcp-server"
LABEL org.opencontainers.image.vendor="Gildara"
LABEL org.opencontainers.image.licenses="MIT"
