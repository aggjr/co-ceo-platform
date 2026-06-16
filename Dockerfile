# co-CEO Platform - producao (API + frontend estatico)
FROM node:22-bookworm-slim AS deps-build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --cache /tmp/npm-cache --prefer-online \
  && npm cache clean --force --cache /tmp/npm-cache

FROM node:22-bookworm-slim AS deps-prod

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --cache /tmp/npm-cache --prefer-online \
  && npm cache clean --force --cache /tmp/npm-cache

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY --from=deps-build /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/src/database/migrations ./src/database/migrations

EXPOSE 3001

CMD ["node", "dist/index.js"]
