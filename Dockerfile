# Build context is the repo root (Railway sets this via dockerfilePath).
# All COPY paths are relative to the repo root.

# ── Stage 1: Build ──
FROM node:20-slim AS build
WORKDIR /app

COPY gacha-agent-core/package.json gacha-agent-core/package-lock.json ./
RUN npm ci

COPY gacha-agent-core/tsconfig.json ./
COPY gacha-agent-core/src/ src/
RUN npm run build

# ── Stage 2: Runtime ──
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production

COPY gacha-agent-core/package.json gacha-agent-core/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ dist/

# Skill files served by the API
COPY gacha-openclaw-skill/ /app/skill/
ENV SKILL_DIR=/app/skill

# Public assets (chat UI)
COPY gacha-agent-core/public/ public/

# Data directory for persistent storage (mount a volume here)
RUN mkdir -p /app/data
ENV DATA_PATH=/app/data

EXPOSE 3577

CMD ["npm", "run", "start:prod"]
