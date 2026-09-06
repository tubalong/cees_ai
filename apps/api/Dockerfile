FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /workspace
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY . .
RUN pnpm install --frozen-lockfile --filter @workbench/api...
RUN pnpm --filter @workbench/ai-service-client build \
    && DATABASE_URL=postgresql://cees:change_me@localhost:5432/cees_ai pnpm --filter @workbench/api prisma:generate \
    && pnpm --filter @workbench/api build

FROM node:22-alpine
WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/packages/ai-service-client ./packages/ai-service-client

WORKDIR /workspace/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
