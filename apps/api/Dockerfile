ARG NODE_BASE_IMAGE=node:24-alpine
FROM ${NODE_BASE_IMAGE} AS build
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /workspace
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY . .
RUN pnpm install --frozen-lockfile --filter @cees/api...
RUN pnpm --filter @cees/ai-service-client build \
    && DATABASE_URL=postgresql://cees:change_me@localhost:5432/cees_ai pnpm --filter @cees/api prisma:generate \
    && pnpm --filter @cees/api build

FROM ${NODE_BASE_IMAGE}
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
