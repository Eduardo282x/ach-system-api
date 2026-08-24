# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
FROM node:22-bookworm-slim AS builder

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=development

RUN npm i -g pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./

RUN pnpm install --frozen-lockfile

COPY src ./src

RUN pnpm exec prisma generate && pnpm run build

# ---- Stage 2: prod deps ----
FROM node:22-bookworm-slim AS prod-deps

ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN npm i -g pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

RUN pnpm install --frozen-lockfile --prod

# ---- Stage 3: runner ----
FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

RUN chown node:node /app

USER node

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./

EXPOSE 3004

CMD ["node", "dist/src/main.js"]
